import { Request, Response, NextFunction } from 'express';
import { Analysis } from '../analyses/analysis.model';
import { GraphNode, GraphNodeDocument } from './graphNode.model';
import { GraphEdge } from './graphEdge.model';
import { assertOwnership } from '../../utils/ownershipCheck';
import { requireParam } from '../../middleware/validate';
import { AppError } from '../../utils/appError';

/** Loads the analysis (ownership-guarded) and asserts it finished. */
export async function getDoneAnalysisOrThrow(req: Request) {
  const analysis = await assertOwnership(Analysis, requireParam(req, 'id'), req.user!.id);
  if (analysis.status !== 'done') {
    throw new AppError(
      409,
      'ANALYSIS_NOT_READY',
      `Analysis status is '${analysis.status}' — insights are available once it completes`
    );
  }
  return analysis;
}

/**
 * GET /api/v1/analyses/:id/graph?level=file|symbol
 * Map data: nodes + edges. `level=file` (default) returns file nodes and
 * import edges only — what the frontend map canvas renders. `level=symbol`
 * returns everything, including call edges (larger payload).
 */
export async function getGraph(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const level = req.query.level === 'symbol' ? 'symbol' : 'file';

    const nodeFilter: Record<string, unknown> = { analysisId: analysis._id };
    if (level === 'file') nodeFilter.kind = { $in: ['repo', 'file'] };

    const [nodes, edges] = await Promise.all([
      GraphNode.find(nodeFilter)
        .select(
          'key kind path name loc exported fanIn fanOut endLine paramCount complexity'
        )
        .lean(),
      GraphEdge.find({ analysisId: analysis._id, ...(level === 'file' ? { kind: 'imports' } : {}) })
        .select('from to kind')
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        commitSha: analysis.commitSha,
        level,
        nodes: nodes.map(serializeGraphNode),
        edges: edges.map((e) => ({
          from: e.from,
          to: e.to,
          kind: e.kind,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

function serializeGraphNode(n: {
  key: unknown;
  kind: unknown;
  path?: unknown;
  name?: unknown;
  loc?: unknown;
  exported?: unknown;
  fanIn?: unknown;
  fanOut?: unknown;
  endLine?: unknown;
  paramCount?: unknown;
  complexity?: unknown;
}) {
  return {
    id: String(n.key),
    kind: n.kind,
    path: n.path ?? null,
    name: n.name ?? null,
    loc: n.loc ?? null,
    exported: n.exported ?? null,
    fanIn: Number(n.fanIn ?? 0),
    fanOut: Number(n.fanOut ?? 0),
    endLine: n.endLine ?? null,
    paramCount: n.paramCount ?? null,
    complexity: n.complexity ?? null,
  };
}

// ── Tree view (PRD §4.1 structural map) ──────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  loc?: number;
  fanIn?: number;
  fanOut?: number;
  symbolCount?: number;
  children?: TreeNode[];
}

/**
 * GET /api/v1/graph/:id/tree
 * Nested repo file tree derived from file nodes, annotated with LOC, fan-in /
 * fan-out and symbol counts. Directories are synthesized from path segments.
 */
export async function getGraphTree(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);

    const [fileNodes, symbolCounts] = await Promise.all([
      GraphNode.find({ analysisId: analysis._id, kind: 'file' })
        .select('path loc fanIn fanOut')
        .lean(),
      GraphNode.aggregate<{ _id: string; count: number }>([
        { $match: { analysisId: analysis._id, kind: { $in: ['function', 'method', 'class'] } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = new Map(symbolCounts.map((row) => [String(row._id ?? ''), row.count]));
    const root: TreeNode = { name: '/', path: '', type: 'dir', children: [] };

    const ensureDir = (segments: string[]): TreeNode => {
      let cursor = root;
      let built = '';
      for (const segment of segments) {
        built = built ? `${built}/${segment}` : segment;
        cursor.children ??= [];
        let next = cursor.children.find(
          (child) => child.type === 'dir' && child.name === segment
        );
        if (!next) {
          next = { name: segment, path: built, type: 'dir', children: [] };
          cursor.children.push(next);
        }
        cursor = next;
      }
      return cursor;
    };

    for (const node of fileNodes) {
      const filePath = String(node.path ?? '');
      if (!filePath) continue;
      const segments = filePath.split('/').filter(Boolean);
      const fileName = segments.pop() ?? filePath;
      const parent = ensureDir(segments);
      parent.children ??= [];
      parent.children.push({
        name: fileName,
        path: filePath,
        type: 'file',
        loc: Number(node.loc ?? 0),
        fanIn: Number(node.fanIn ?? 0),
        fanOut: Number(node.fanOut ?? 0),
        symbolCount: counts.get(filePath) ?? 0,
      });
    }

    const sortTree = (node: TreeNode): void => {
      if (!node.children) return;
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) sortTree(child);
    };
    sortTree(root);

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        fileCount: fileNodes.length,
        root,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Node detail (PRD §4.2 inspector panel) ───────────────────────────────

function normalizeNodeKey(raw: string): string {
  if (raw.startsWith('file:') || raw.startsWith('sym:') || raw.startsWith('repo:')) {
    return raw;
  }
  return `file:${raw.replace(/^\/+/, '')}`;
}

/**
 * GET /api/v1/graph/:id/node?node=<key>
 * One node plus its immediate neighbours: `incoming` (importers/callers) and
 * `outgoing` (imports/callees), with edge kinds preserved.
 */
export async function getGraphNode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const key = normalizeNodeKey(String(req.query.node));

    const node = await GraphNode.findOne({ analysisId: analysis._id, key }).lean();
    if (!node) {
      throw new AppError(404, 'NODE_NOT_FOUND', `No graph node with key '${key}'`);
    }

    const [incomingEdges, outgoingEdges] = await Promise.all([
      GraphEdge.find({ analysisId: analysis._id, to: key }).select('from to kind').lean(),
      GraphEdge.find({ analysisId: analysis._id, from: key }).select('from to kind').lean(),
    ]);

    const neighbourKeys = [
      ...new Set([
        ...incomingEdges.map((e) => String(e.from)),
        ...outgoingEdges.map((e) => String(e.to)),
      ]),
    ];

    const neighbours = await GraphNode.find({
      analysisId: analysis._id,
      key: { $in: neighbourKeys },
    })
      .select('key kind path name loc exported fanIn fanOut')
      .lean();
    const byKey = new Map(neighbours.map((n) => [String(n.key), n]));

    const brief = (edgeKey: string) => {
      const found = byKey.get(edgeKey);
      return {
        key: edgeKey,
        kind: found?.kind ?? null,
        path: found?.path ?? null,
        name: found?.name ?? null,
        loc: found?.loc ?? null,
      };
    };

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        node: serializeGraphNode(node as unknown as Parameters<typeof serializeGraphNode>[0]),
        incoming: incomingEdges
          .map((e) => ({ ...brief(String(e.from)), edgeKind: e.kind }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        outgoing: outgoingEdges
          .map((e) => ({ ...brief(String(e.to)), edgeKind: e.kind }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        incomingCount: incomingEdges.length,
        outgoingCount: outgoingEdges.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Callers traversal (PRD §4.2 "who calls this?") ───────────────────────

/**
 * GET /api/v1/graph/:id/callers?node=<key>&depth=1
 * Reverse traversal over `calls` edges for symbol nodes (or `calls` +
 * `imports` for file nodes). `depth` is clamped to 1–5.
 */
export async function getGraphCallers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await getDoneAnalysisOrThrow(req);
    const key = normalizeNodeKey(String(req.query.node));
    const depth = Math.min(Math.max(Number(req.query.depth ?? 1) || 1, 1), 5);
    const isSymbol = key.startsWith('sym:');

    const exists = await GraphNode.exists({ analysisId: analysis._id, key });
    if (!exists) {
      throw new AppError(404, 'NODE_NOT_FOUND', `No graph node with key '${key}'`);
    }

    const edgeKinds: Array<'calls' | 'imports'> = isSymbol
      ? ['calls']
      : ['calls', 'imports'];
    const edges = await GraphEdge.find({
      analysisId: analysis._id,
      kind: { $in: edgeKinds },
    })
      .select('from to kind')
      .lean();

    const reverse = new Map<string, Set<string>>();
    for (const edge of edges) {
      const from = String(edge.from);
      const to = String(edge.to);
      if (!from || !to || from === to) continue;
      const set = reverse.get(to) ?? new Set<string>();
      set.add(from);
      reverse.set(to, set);
    }

    const visited = new Set<string>([key]);
    let frontier: string[] = [key];
    const found: Array<{ key: string; depth: number }> = [];

    for (let level = 1; level <= depth; level++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const caller of reverse.get(current) ?? []) {
          if (visited.has(caller)) continue;
          visited.add(caller);
          found.push({ key: caller, depth: level });
          next.push(caller);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    const nodes = await GraphNode.find({
      analysisId: analysis._id,
      key: { $in: found.map((f) => f.key) },
    })
      .select('key kind path name loc exported fanIn fanOut')
      .lean();
    const byKey = new Map(nodes.map((n) => [String(n.key), n]));

    res.status(200).json({
      success: true,
      data: {
        analysisId: String(analysis._id),
        node: key,
        depth,
        callers: found
          .map((entry) => {
            const node = byKey.get(entry.key);
            return {
              key: entry.key,
              depth: entry.depth,
              kind: node?.kind ?? null,
              path: node?.path ?? null,
              name: node?.name ?? null,
              loc: node?.loc ?? null,
            };
          })
          .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key)),
        count: found.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

export type { GraphNodeDocument };
