import { useMemo } from 'react';
import type { Cycle, CyclesPayload, GraphEdge, GraphNode } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Badge, Button, EmptyState, ErrorNotice, Spinner } from '@/components/ui';
import { SeverityBadge } from '@/components/StatusBadge';
import { fileKey } from '@/lib/nodeKey';

interface BreakSuggestion {
  from: string;
  to: string;
  reason: string;
}

/**
 * Heuristic break-point: prefer breaking the hop whose source imports the
 * fewest files overall (least collateral), then the lexicographically first
 * hop so the suggestion is stable.
 */
export function suggestBreakPoint(
  cycle: Cycle,
  nodes: GraphNode[],
  edges: GraphEdge[]
): BreakSuggestion | null {
  if (cycle.path.length < 2) return null;

  const fanOut = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'file' && node.path) fanOut.set(node.path, node.fanOut);
  }

  const importEdges = new Set(
    edges.filter((edge) => edge.kind === 'imports').map((edge) => `${edge.from}|${edge.to}`)
  );

  const hops: BreakSuggestion[] = [];
  for (let index = 0; index < cycle.path.length; index += 1) {
    const from = cycle.path[index];
    const to = cycle.path[(index + 1) % cycle.path.length];
    if (!from || !to) continue;
    if (!importEdges.has(`file:${from}|file:${to}`)) continue;
    hops.push({
      from,
      to,
      reason: `${from} imports ${fanOut.get(from) ?? 0} file(s) in total`,
    });
  }

  if (hops.length === 0) {
    const from = cycle.path[0];
    const to = cycle.path[1 % cycle.path.length];
    return from && to ? { from, to, reason: 'first hop in the cycle' } : null;
  }

  hops.sort((a, b) => {
    const fa = fanOut.get(a.from) ?? 0;
    const fb = fanOut.get(b.from) ?? 0;
    return fa - fb || a.from.localeCompare(b.from);
  });

  return hops[0] ?? null;
}

export function CyclesDashboard({
  data,
  isLoading,
  error,
  onRetry,
  nodes,
  edges,
  onHighlight,
  onExplainFile,
}: {
  data: CyclesPayload | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onHighlight: (paths: string[]) => void;
  onExplainFile: (key: string) => void;
}) {
  const counts = useMemo(() => {
    const result = { high: 0, medium: 0, low: 0 };
    for (const cycle of data?.cycles ?? []) result[cycle.severity] += 1;
    return result;
  }, [data]);

  if (isLoading) {
    return (
      <div className="loading-block">
        <Spinner label="Detecting strongly connected components…" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorNotice
        error={{
          code: 'CYCLES_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Cycle detection failed.',
        }}
        onRetry={onRetry}
      />
    );
  }

  if (!data || data.cycles.length === 0) {
    return (
      <EmptyState
        icon="cycle"
        title="No circular dependencies"
        description="Every import chain in this repository is acyclic. That is the healthy case."
      />
    );
  }

  return (
    <div className="cycles">
      <header className="cycles__hero">
        <div>
          <h2>Circular dependencies</h2>
          <p>
            Strongly connected components in the import graph. Cycles make modules hard to split,
            test and reason about — break the suggested hop first.
          </p>
        </div>
        <div className="cycles__counts">
          <span className="cycles__count cycles__count--high">{counts.high} high</span>
          <span className="cycles__count cycles__count--medium">{counts.medium} medium</span>
          <span className="cycles__count cycles__count--low">{counts.low} low</span>
        </div>
      </header>

      <ol className="cycle-list">
        {data.cycles.map((cycle, index) => {
          const suggestion = suggestBreakPoint(cycle, nodes, edges);
          return (
            <li key={`${cycle.path.join('>')}-${index}`} className="cycle-card">
              <header className="cycle-card__header">
                <div className="cycle-card__title">
                  <span className="cycle-card__index">#{index + 1}</span>
                  <h3>
                    {cycle.length} {cycle.length === 1 ? 'file' : 'files'} in a loop
                  </h3>
                  <SeverityBadge severity={cycle.severity} />
                </div>
                <div className="cycle-card__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="graph"
                    onClick={() => onHighlight(cycle.path)}
                  >
                    Highlight on map
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="sparkles"
                    onClick={() => onExplainFile(fileKey(cycle.path[0] ?? ''))}
                  >
                    Explain first file
                  </Button>
                </div>
              </header>

              <div className="cycle-chain" aria-label="Cycle path">
                {cycle.path.map((path, step) => (
                  <span key={`${path}-${step}`} className="cycle-chain__item">
                    <button
                      type="button"
                      className="cycle-chip"
                      onClick={() => onHighlight([path])}
                      title={`Focus ${path}`}
                    >
                      {path}
                    </button>
                    <Icon name="arrow-right" size={14} className="cycle-chain__arrow" />
                  </span>
                ))}
                {cycle.path[0] ? (
                  <button
                    type="button"
                    className="cycle-chip cycle-chip--close"
                    onClick={() => onHighlight([cycle.path[0] as string])}
                    title={`Loop back to ${cycle.path[0]}`}
                  >
                    {cycle.path[0]}
                  </button>
                ) : null}
              </div>

              {suggestion ? (
                <p className="cycle-card__suggestion">
                  <Badge tone="amber" icon="alert">
                    suggested break point
                  </Badge>
                  Break <code>{suggestion.from}</code> → <code>{suggestion.to}</code> first —{' '}
                  {suggestion.reason}. This is a heuristic, not an automatic refactor.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
