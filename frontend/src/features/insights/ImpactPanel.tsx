import type { ImpactDirection, ImpactPayload } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Badge, Button, EmptyState, ErrorNotice, Spinner } from '@/components/ui';
import { RiskBadge } from '@/components/StatusBadge';
import { fileKey } from '@/lib/nodeKey';

const DIRECTION_COPY: Record<
  ImpactDirection,
  { label: string; question: string; empty: string }
> = {
  dependents: {
    label: 'What breaks',
    question: 'What breaks if I change this?',
    empty: 'No other files depend on this node.',
  },
  dependencies: {
    label: 'What it needs',
    question: 'What does this node rely on?',
    empty: 'This node does not depend on other files.',
  },
};

export function ImpactPanel({
  data,
  isLoading,
  error,
  direction,
  onDirectionChange,
  onSelectPath,
  onExplainPath,
  onBack,
  onRetry,
}: {
  data: ImpactPayload | undefined;
  isLoading: boolean;
  error: unknown;
  direction: ImpactDirection;
  onDirectionChange: (direction: ImpactDirection) => void;
  onSelectPath: (path: string) => void;
  onExplainPath: (path: string) => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const copy = DIRECTION_COPY[direction];

  return (
    <div className="inspector impact-panel">
      <header className="inspector__header">
        <div>
          <span className="inspector__eyebrow">
            <Badge tone="violet" icon="impact">
              Impact mode
            </Badge>
          </span>
          <h2>{copy.label}</h2>
          <p className="inspector__key">{copy.question}</p>
        </div>
        <Button size="sm" variant="ghost" icon="arrow-left" onClick={onBack}>
          Inspector
        </Button>
      </header>

      <div className="segmented" role="tablist" aria-label="Impact direction">
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'dependents'}
          className={direction === 'dependents' ? 'segmented--active' : ''}
          onClick={() => onDirectionChange('dependents')}
        >
          Dependents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={direction === 'dependencies'}
          className={direction === 'dependencies' ? 'segmented--active' : ''}
          onClick={() => onDirectionChange('dependencies')}
        >
          Dependencies
        </button>
      </div>

      {isLoading ? (
        <div className="loading-block loading-block--compact">
          <Spinner /> Walking the graph…
        </div>
      ) : error ? (
        <ErrorNotice
          error={{
            code: 'IMPACT_UNAVAILABLE',
            message: error instanceof Error ? error.message : 'Impact analysis failed.',
          }}
          onRetry={onRetry}
          compact
        />
      ) : !data ? (
        <EmptyState icon="impact" title="Select a node" description="Pick a file or symbol on the map to compute its blast radius." />
      ) : (
        <>
          <div className="impact-stats">
            <div>
              <span>Affected files</span>
              <strong>{data.count}</strong>
            </div>
            <div>
              <span>Fan-in</span>
              <strong>{data.fanIn}</strong>
            </div>
            <div>
              <span>Fan-out</span>
              <strong>{data.fanOut}</strong>
            </div>
            <div>
              <span>Max depth</span>
              <strong>{data.criticalDepth}</strong>
            </div>
          </div>

          <div className="impact-origin">
            <Icon name="impact" size={14} />
            <span>{data.node}</span>
          </div>

          {data.affected.length === 0 ? (
            <p className="inspector__empty">{copy.empty}</p>
          ) : (
            <section className="inspector__section">
              <header className="inspector__section-head">
                <h3>Ranked affected files</h3>
                <span>{data.count}</span>
              </header>
              <ul className="affected-list">
                {data.affected.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className="affected"
                      onClick={() => onSelectPath(item.path)}
                      title={`Select ${item.path} on the map`}
                    >
                      <span className="affected__rank">d{item.depth}</span>
                      <span className="affected__body">
                        <span className="affected__path">{item.path}</span>
                        <span className="affected__meta">
                          {item.direct ? (
                            <Badge tone="red">direct</Badge>
                          ) : (
                            <Badge tone="gray">transitive</Badge>
                          )}
                          <RiskBadge risk={item.risk} />
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onExplainPath(item.path)}
                    >
                      explain
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.criticalPath.length > 1 ? (
            <section className="inspector__section">
              <header className="inspector__section-head">
                <h3>Critical path</h3>
                <span>depth {data.criticalDepth}</span>
              </header>
              <p className="inspector__caption">
                Deepest propagation chain — the riskiest route through this subgraph.
              </p>
              <ol className="critical-path">
                {data.criticalPath.map((step, index) => (
                  <li key={`${step.path}-${step.depth}`}>
                    <button
                      type="button"
                      className="critical-path__step"
                      onClick={() => onSelectPath(step.path)}
                    >
                      <span className="critical-path__index">{index + 1}</span>
                      <span>{step.path}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <p className="inspector__caption">
            Tip: click any affected file on the map to re-root the analysis there.
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon="graph"
            onClick={() => onSelectPath(fileKey(data.node).slice(5))}
          >
            Focus origin on map
          </Button>
        </>
      )}
    </div>
  );
}
