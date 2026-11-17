import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from '@/api/types';

export interface Point {
  x: number;
  y: number;
}

export interface NodeBox extends Point {
  width: number;
  height: number;
}

const SIZE_BY_KIND: Record<string, { width: number; height: number }> = {
  repo: { width: 150, height: 48 },
  file: { width: 210, height: 56 },
  class: { width: 200, height: 58 },
  function: { width: 210, height: 58 },
  method: { width: 210, height: 58 },
};

export function nodeBox(kind: GraphNode['kind']): { width: number; height: number } {
  return SIZE_BY_KIND[kind] ?? SIZE_BY_KIND.file!;
}

/**
 * Left-to-right Dagre layout, computed client-side (PRD §13.2).
 * Nodes are sorted for determinism: the same graph always produces the same
 * map, which keeps saved views and screenshots reproducible.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, NodeBox> {
  const positions = new Map<string, NodeBox>();
  if (nodes.length === 0) return positions;

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 34,
    ranksep: 110,
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const known = new Set(nodes.map((node) => node.id));
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  for (const node of ordered) {
    const box = nodeBox(node.kind);
    graph.setNode(node.id, { width: box.width, height: box.height });
  }

  const seen = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
    const id = `${edge.from}->${edge.to}:${edge.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    graph.setEdge(edge.from, edge.to, {}, id);
  }

  dagre.layout(graph);

  for (const node of ordered) {
    const laidOut = graph.node(node.id) as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    if (!laidOut) continue;
    positions.set(node.id, {
      x: laidOut.x - laidOut.width / 2,
      y: laidOut.y - laidOut.height / 2,
      width: laidOut.width,
      height: laidOut.height,
    });
  }

  return positions;
}

/** Degrees used to size/rank nodes in the sidebar and legend. */
export function degreeOf(node: GraphNode): number {
  return node.fanIn + node.fanOut;
}

/**
 * Files that belong to a cycle, used to highlight cycle members on the map.
 */
export function cycleFileSet(cycles: Array<{ path: string[] }>): Set<string> {
  const files = new Set<string>();
  for (const cycle of cycles) {
    for (const path of cycle.path) files.add(path);
  }
  return files;
}
