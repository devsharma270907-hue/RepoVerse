import { useEffect, useMemo } from 'react';
import type { ExplainPayload } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Badge, Button, ErrorNotice, Spinner } from '@/components/ui';
import { RichText } from '@/components/RichText';
import { formatDate } from '@/lib/format';
import type { AppError } from '@/lib/errors';

export function ExplainDrawer({
  open,
  nodeKey,
  data,
  isLoading,
  error,
  onClose,
  onRetry,
}: {
  open: boolean;
  nodeKey: string | null;
  data: ExplainPayload | undefined;
  isLoading: boolean;
  error: AppError | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const sourceLines = useMemo(() => {
    if (!data?.source) return [];
    return [
      `// ${data.source.path} — lines ${data.source.startLine}–${data.source.endLine}`,
      data.source.truncated ? '// (excerpt truncated for the model)' : '',
    ].filter(Boolean);
  }, [data]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="AI explanation">
        <header className="drawer__header">
          <div>
            <span className="drawer__eyebrow">
              <Icon name="sparkles" size={14} /> AI explanation
            </span>
            <h2 title={nodeKey ?? undefined}>{nodeKey ?? 'Node'}</h2>
            <p className="drawer__disclaimer">
              AI-generated guidance grounded in this repository's graph — not authoritative
              documentation. Verify against the source shown below.
            </p>
          </div>
          <Button variant="ghost" size="sm" icon="close" aria-label="Close explanation" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="drawer__body">
          {isLoading ? (
            <div className="drawer__loading">
              <Spinner label="Grounded explanation in progress…" />
              <p>Fetching the source excerpt and graph context for this node.</p>
            </div>
          ) : error ? (
            <div className="drawer__error">
              <ErrorNotice error={error} onRetry={onRetry} />
              {error.code === 'AI_NOT_CONFIGURED' ? (
                <p className="drawer__hint">
                  Set <code>ANTHROPIC_API_KEY</code> on the backend to enable explanations. The
                  dependency map, impact analysis and health scoring work without it.
                </p>
              ) : null}
            </div>
          ) : data ? (
            <>
              <div className="drawer__meta">
                <Badge tone="violet" icon="sparkles">
                  {data.modelVersion}
                </Badge>
                <Badge tone={data.cached ? 'green' : 'blue'}>
                  {data.cached ? 'cached result' : 'fresh call'}
                </Badge>
                {typeof data.redactions === 'number' && data.redactions > 0 ? (
                  <Badge tone="amber" icon="shield">
                    {data.redactions} secret{data.redactions === 1 ? '' : 's'} redacted
                  </Badge>
                ) : null}
                <span className="drawer__timestamp">
                  <Icon name="clock" size={13} /> {formatDate(data.generatedAt)}
                </span>
              </div>

              <section className="drawer__section">
                <h3>Summary</h3>
                <RichText text={data.explanation.summary} />
              </section>

              {data.explanation.keyPoints.length > 0 ? (
                <section className="drawer__section">
                  <h3>Key points</h3>
                  <ul className="bullets">
                    {data.explanation.keyPoints.map((point) => (
                      <li key={point}>
                        <RichText text={point} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {data.explanation.potentialIssues.length > 0 ? (
                <section className="drawer__section">
                  <h3>
                    Potential issues <Badge tone="amber">{data.explanation.potentialIssues.length}</Badge>
                  </h3>
                  <ul className="bullets bullets--warning">
                    {data.explanation.potentialIssues.map((issue) => (
                      <li key={issue}>
                        <RichText text={issue} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {data.graphContext ? (
                <section className="drawer__section">
                  <h3>Graph context</h3>
                  <div className="context-grid">
                    {(
                      [
                        ['Imports', data.graphContext.imports],
                        ['Imported by', data.graphContext.dependents],
                        ['Callers', data.graphContext.callers],
                        ['Calls', data.graphContext.callees],
                      ] as const
                    ).map(([label, values]) => (
                      <div key={label} className="context-grid__cell">
                        <span>{label}</span>
                        {values.length === 0 ? (
                          <em>none</em>
                        ) : (
                          <div className="context-grid__values">
                            {values.map((value) => (
                              <code key={`${label}-${value}`}>{value}</code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="drawer__section">
                <h3>
                  Source excerpt{' '}
                  <Badge tone="gray">
                    {data.source.startLine}–{data.source.endLine}
                  </Badge>
                </h3>
                <p className="drawer__caption">
                  Escaped source text, shown exactly as it was grounded. Secrets are redacted
                  before the model sees them.
                </p>
                {data.source.text ? (
                  <pre className="source-block">
                    <code>
                      {sourceLines.join('\n')}
                      {'\n'}
                      {data.source.text}
                    </code>
                  </pre>
                ) : (
                  <p className="drawer__hint">
                    The excerpt itself is not cached for this result. Re-run Explain to fetch the
                    exact lines again.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
