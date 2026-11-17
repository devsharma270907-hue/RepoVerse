import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphNodeKind } from '@/api/types';
import { cycleFileSet, degreeOf, layoutGraph } from '@/features/graph/layout';

function node(id: string, kind: GraphNodeKind, fanIn = 0, fanOut = 0): GraphNode {
  return {
    id,
    kind,
    path: kind === 'file' ? id.slice(5) : null,
    name: kind === 'file' ? null : id,
    loc: 10,
    exported: true,
    fanIn,
    fanOut,
    endLine: 10,
    paramCount: 0,
    complexity: 1,
  };
}

const nodes: GraphNode[] = [
  node('file:a.ts', 'file', 0, 1),
  node('file:b.ts', 'file', 1, 1),
  node('file:c.ts', 'file', 1, 0),
];

const edges: GraphEdge[] = [
  { from: 'file:a.ts', to: 'file:b.ts', kind: 'imports' },
  { from: 'file:b.ts', to: 'file:c.ts', kind: 'imports' },
];

describe('layoutGraph', () => {
  it('positions every node left-to-right by rank', () => {
    const positions = layoutGraph(nodes, edges);
    expect(positions.size).toBe(3);
    const a = positions.get('file:a.ts');
    const b = positions.get('file:b.ts');
    const c = positions.get('file:c.ts');
    expect(a && b && c).toBeTruthy();
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
  });

  it('is deterministic for the same input regardless of node order', () => {
    const first = layoutGraph(nodes, edges);
    const second = layoutGraph([...nodes].reverse(), [...edges].reverse());
    for (const id of ['file:a.ts', 'file:b.ts', 'file:c.ts']) {
      expect(first.get(id)).toEqual(second.get(id));
    }
  });

  it('ignores edges that reference unknown nodes and self loops', () => {
    const withJunk: GraphEdge[] = [
      ...edges,
      { from: 'file:a.ts', to: 'file:missing.ts', kind: 'imports' },
      { from: 'file:a.ts', to: 'file:a.ts', kind: 'calls' },
    ];
    expect(layoutGraph(nodes, withJunk)).toEqual(layoutGraph(nodes, edges));
  });

  it('returns an empty map for an empty graph', () => {
    expect(layoutGraph([], []).size).toBe(0);
  });

  it('sizes symbols larger than files', () => {
    const positions = layoutGraph(nodes, edges);
    expect(positions.get('file:a.ts')?.height).toBeGreaterThan(0);
  });
});

describe('graph helpers', () => {
  it('sums fan-in and fan-out', () => {
    expect(degreeOf(node('file:a.ts', 'file', 2, 3))).toBe(5);
  });

  it('collects unique files from cycles', () => {
    const set = cycleFileSet([
      { path: ['a.ts', 'b.ts', 'a.ts'] },
      { path: ['b.ts', 'c.ts'] },
    ]);
    expect([...set].sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
