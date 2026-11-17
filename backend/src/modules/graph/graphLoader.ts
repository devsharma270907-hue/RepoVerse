import { GraphNode } from './graphNode.model';
import { GraphEdge } from './graphEdge.model';
import { BuiltGraph } from '../../services/analyzer/graphBuilder';

/**
 * Rehydrates a persisted analysis into the `BuiltGraph` shape the analyzer
 * services consume (health scoring, impact analysis).
 *
 * Persisted nodes already carry fanIn/fanOut and the symbol metrics
 * (endLine, paramCount, complexity), so a single lean query is enough —
 * no reparse and no source access (PRD §10.5 retention).
 */
export async function loadBuiltGraph(analysisId: unknown): Promise<BuiltGraph> {
  const [nodes, edges] = await Promise.all([
    GraphNode.find({ analysisId })
      .select(
        'key kind path name loc exported fanIn fanOut endLine paramCount complexity'
      )
      .lean(),
    GraphEdge.find({ analysisId }).select('from to kind').lean(),
  ]);

  return {
    nodes: nodes.map((n) => ({
      key: String(n.key),
      kind: n.kind as BuiltGraph['nodes'][number]['kind'],
      ...(n.path ? { path: String(n.path) } : {}),
      ...(n.name ? { name: String(n.name) } : {}),
      ...(n.loc !== undefined && n.loc !== null ? { loc: Number(n.loc) } : {}),
      ...(n.exported !== undefined && n.exported !== null
        ? { exported: Boolean(n.exported) }
        : {}),
      fanIn: Number(n.fanIn ?? 0),
      fanOut: Number(n.fanOut ?? 0),
      ...(n.endLine !== undefined && n.endLine !== null
        ? { endLine: Number(n.endLine) }
        : {}),
      ...(n.paramCount !== undefined && n.paramCount !== null
        ? { paramCount: Number(n.paramCount) }
        : {}),
      ...(n.complexity !== undefined && n.complexity !== null
        ? { complexity: Number(n.complexity) }
        : {}),
    })),
    edges: edges.map((e) => ({
      from: String(e.from),
      to: String(e.to),
      kind: e.kind as BuiltGraph['edges'][number]['kind'],
    })),
    cycles: [],
  };
}
