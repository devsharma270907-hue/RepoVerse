import { Request, Response, NextFunction } from 'express';
import { getDoneAnalysisOrThrow } from '../graph/graph.controller';
import { loadBuiltGraph } from '../graph/graphLoader';
import { GraphEdge } from '../graph/graphEdge.model';
import { GraphNode } from '../graph/graphNode.model';
import { scoreFiles, repoHealthScore } from '../../services/analyzer/health';
import { toPosix } from '../../services/analyzer/ignore';
import { z } from 'zod';

/**
 * GET /api/v1/analyses/:id/cycles — detected circular dependencies
 * (SCC over the import graph, ranked by severity).
 */
export async function getCycles(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        cycles: analysis.cycles ?? [],
        count: analysis.cycles?.length ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/analyses/:id/health — per-file, symbol-aware health scores
 * + repo average (PRD §4.5). Findings carry `line`/`symbol` deep links.
 */
export async function getHealth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const built = await loadBuiltGraph(analysis._id);
    const files = scoreFiles(built);

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        repoScore: repoHealthScore(files),
        files,
      },
    });
  } catch (err) {
    next(err);
  }
}

export const impactQuerySchema = {
  query: z.object({
    node: z
      .string()
      .trim()
      .min(1, 'node query parameter is required (file path or node key)'),
    direction: z.enum(['dependents', 'dependencies']).default('dependents'),
  }),
};

/** Strips our node-key prefixes and returns the owning repo-relative file. */
function nodeKeyToFile(raw: string): string {
  const withoutPrefix = raw.replace(/^file:/, '').replace(/^sym:/, '');
  const hashIdx = withoutPrefix.indexOf('#');
  const filePart = hashIdx >= 0 ? withoutPrefix.slice(0, hashIdx) : withoutPrefix;
  return toPosix(filePart);
}

/**
 * GET /api/v1/analyses/:id/impact?node=<path|key>&direction=dependents|dependencies
 *
 * Impact Analysis (PRD §4.3):
 *  - direction=dependents (default): reverse BFS over import + call edges —
 *    every file transitively affected if this node changes.
 *  - direction=dependencies: forward BFS — everything this node relies on.
 *
 * Also returns direct `fanIn`/`fanOut` and the deepest `criticalPath` through
 * the affected subgraph, so the UI can highlight the riskiest chain.
 */
export async function getImpact(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const nodePath = nodeKeyToFile(String(req.query.node));
    const direction =
      req.query.direction === 'dependencies' ? 'dependencies' : 'dependents';

    const edges = await GraphEdge.find({ analysisId: analysis._id })
      .select('from to kind')
      .lean();

    const dependents = new Map<string, Set<string>>();
    const dependencies = new Map<string, Set<string>>();

    for (const edge of edges) {
      const fromFile = nodeKeyToFile(String(edge.from));
      const toFile = nodeKeyToFile(String(edge.to));
      if (!fromFile || !toFile || fromFile === toFile) continue;

      const upstream = dependents.get(toFile) ?? new Set<string>();
      upstream.add(fromFile);
      dependents.set(toFile, upstream);

      const downstream = dependencies.get(fromFile) ?? new Set<string>();
      downstream.add(toFile);
      dependencies.set(fromFile, downstream);
    }

    const adjacency = direction === 'dependents' ? dependents : dependencies;
    const fanIn = dependents.get(nodePath)?.size ?? 0;
    const fanOut = dependencies.get(nodePath)?.size ?? 0;

    // Expose the persisted node when it exists so the client can link back.
    const fileNode = await GraphNode.findOne({
      analysisId: analysis._id,
      key: `file:${nodePath}`,
    })
      .select('key')
      .lean();

    const visited = new Set<string>([nodePath]);
    const parent = new Map<string, string>();
    const depthOf = new Map<string, number>([[nodePath, 0]]);
    const queue: string[] = [nodePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const next = adjacency.get(current);
      if (!next) continue;
      for (const candidate of next) {
        if (visited.has(candidate)) continue;
        visited.add(candidate);
        parent.set(candidate, current);
        depthOf.set(candidate, (depthOf.get(current) ?? 0) + 1);
        queue.push(candidate);
      }
    }

    const affected = [...visited]
      .filter((path) => path !== nodePath)
      .map((path) => {
        const depth = depthOf.get(path) ?? 0;
        return {
          path,
          depth,
          direct: depth === 1,
          risk: (depth <= 2 ? 'high' : depth <= 4 ? 'medium' : 'low') as
            | 'high'
            | 'medium'
            | 'low',
        };
      })
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

    // Longest chain in the BFS tree = the highest-risk propagation route.
    let deepest = nodePath;
    for (const item of affected) {
      if ((depthOf.get(item.path) ?? 0) > (depthOf.get(deepest) ?? 0)) {
        deepest = item.path;
      }
    }
    const criticalPath: Array<{ path: string; depth: number }> = [];
    for (let cursor: string | undefined = deepest; cursor; cursor = parent.get(cursor)) {
      criticalPath.unshift({ path: cursor, depth: depthOf.get(cursor) ?? 0 });
    }

    res.status(200).json({
      success: true,
      data: {
        node: nodePath,
        nodeKey: fileNode?.key ?? null,
        direction,
        fanIn,
        fanOut,
        affected,
        count: affected.length,
        criticalPath,
        criticalDepth: criticalPath.length === 0 ? 0 : criticalPath.length - 1,
        message:
          affected.length === 0
            ? direction === 'dependents'
              ? 'No other files depend on this node'
              : 'This node does not depend on any other files'
            : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
}
