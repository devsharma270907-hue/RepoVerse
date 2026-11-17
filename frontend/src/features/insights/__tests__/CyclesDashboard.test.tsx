import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Cycle, GraphEdge, GraphNode } from '@/api/types';
import {
  CyclesDashboard,
  suggestBreakPoint,
} from '@/features/insights/CyclesDashboard';

function fileNode(path: string, fanIn: number, fanOut: number): GraphNode {
  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    name: null,
    loc: 10,
    exported: null,
    fanIn,
    fanOut,
    endLine: null,
    paramCount: null,
    complexity: null,
  };
}

const nodes = [
  fileNode('a.ts', 0, 1),
  fileNode('b.ts', 1, 5),
  fileNode('c.ts', 1, 2),
];

const edges: GraphEdge[] = [
  { from: 'file:a.ts', to: 'file:b.ts', kind: 'imports' },
  { from: 'file:b.ts', to: 'file:c.ts', kind: 'imports' },
  { from: 'file:c.ts', to: 'file:a.ts', kind: 'imports' },
];

const cycle: Cycle = { path: ['a.ts', 'b.ts', 'c.ts'], length: 3, severity: 'medium' };

describe('suggestBreakPoint', () => {
  it('prefers the hop with the fewest outgoing imports', () => {
    expect(suggestBreakPoint(cycle, nodes, edges)).toMatchObject({
      from: 'a.ts',
      to: 'b.ts',
    });
  });

  it('falls back to the first hop when no import edges are present', () => {
    expect(suggestBreakPoint(cycle, nodes, [])).toMatchObject({
      from: 'a.ts',
      to: 'b.ts',
    });
  });

  it('returns null for a single-node cycle', () => {
    expect(
      suggestBreakPoint({ path: ['a.ts'], length: 1, severity: 'low' }, nodes, edges)
    ).toBeNull();
  });
});

describe('<CyclesDashboard />', () => {
  it('shows the healthy empty state', () => {
    render(
      <CyclesDashboard
        data={{ analysisId: 'a1', cycles: [], count: 0 }}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        nodes={nodes}
        edges={edges}
        onHighlight={() => undefined}
        onExplainFile={() => undefined}
      />
    );
    expect(screen.getByText('No circular dependencies')).toBeInTheDocument();
  });

  it('lists cycles with severity counts and a break suggestion', () => {
    render(
      <CyclesDashboard
        data={{ analysisId: 'a1', cycles: [cycle], count: 1 }}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        nodes={nodes}
        edges={edges}
        onHighlight={() => undefined}
        onExplainFile={() => undefined}
      />
    );
    expect(screen.getByText('3 files in a loop')).toBeInTheDocument();
    expect(screen.getByText('1 medium')).toBeInTheDocument();
    expect(screen.getByText(/suggested break point/i)).toBeInTheDocument();
    expect(screen.getAllByText('a.ts').length).toBeGreaterThan(0);
  });

  it('highlights a cycle on the map', async () => {
    const onHighlight = vi.fn();
    render(
      <CyclesDashboard
        data={{ analysisId: 'a1', cycles: [cycle], count: 1 }}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
        nodes={nodes}
        edges={edges}
        onHighlight={onHighlight}
        onExplainFile={() => undefined}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /highlight on map/i }));
    expect(onHighlight).toHaveBeenCalledWith(['a.ts', 'b.ts', 'c.ts']);
  });

  it('renders an error with a retry action', async () => {
    const onRetry = vi.fn();
    render(
      <CyclesDashboard
        data={undefined}
        isLoading={false}
        error={new Error('nope')}
        onRetry={onRetry}
        nodes={[]}
        edges={[]}
        onHighlight={() => undefined}
        onExplainFile={() => undefined}
      />
    );

    expect(screen.getByText('CYCLES UNAVAILABLE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
