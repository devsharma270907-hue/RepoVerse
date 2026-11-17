import { useMemo, useState } from 'react';
import type { FileHealth, HealthPayload } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Badge, Button, EmptyState, ErrorNotice, ScoreRing, Spinner } from '@/components/ui';
import { fileKey, symbolKey } from '@/lib/nodeKey';
import { formatNumber } from '@/lib/format';

type SortKey = 'score' | 'path' | 'complexity' | 'loc';

function scoreTone(score: number): string {
  if (score >= 85) return 'score--good';
  if (score >= 65) return 'score--warn';
  return 'score--bad';
}

function FileRow({
  file,
  onLocate,
  onExplain,
}: {
  file: FileHealth;
  onLocate: (key: string) => void;
  onExplain: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const worst = file.penalties.slice(0, 2).map((penalty) => penalty.code.replaceAll('_', ' ').toLowerCase());

  return (
    <>
      <tr className={open ? 'health-row health-row--open' : 'health-row'}>
        <td className="health-row__file">
          <button
            type="button"
            className="health-row__toggle"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
            <span title={file.path}>{file.path}</span>
          </button>
          {worst.length > 0 ? <span className="health-row__worst">{worst.join(' · ')}</span> : null}
        </td>
        <td>
          <span className={['score-pill', scoreTone(file.score)].join(' ')}>{file.score}</span>
        </td>
        <td>{file.metrics.symbolCount}</td>
        <td>{file.metrics.maxComplexity.toFixed(1)}</td>
        <td>
          {file.metrics.fanIn} / {file.metrics.fanOut}
        </td>
        <td>
          {file.metrics.deadCodeCandidate ? (
            <Badge tone="red">dead</Badge>
          ) : file.metrics.instability >= 0.8 ? (
            <Badge tone="amber">unstable</Badge>
          ) : (
            <Badge tone="green">ok</Badge>
          )}
        </td>
        <td className="health-row__actions">
          <Button
            size="sm"
            variant="ghost"
            icon="impact"
            onClick={() => onLocate(fileKey(file.path))}
          >
            Locate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="sparkles"
            onClick={() => onExplain(fileKey(file.path))}
          >
            Explain
          </Button>
        </td>
      </tr>
      {open ? (
        <tr className="health-detail-row">
          <td colSpan={7}>
            <div className="health-findings">
              <div className="health-findings__metrics">
                <span>
                  <em>LOC</em> {formatNumber(file.metrics.loc)}
                </span>
                <span>
                  <em>Avg complexity</em> {file.metrics.avgComplexity.toFixed(1)}
                </span>
                <span>
                  <em>Instability</em> {file.metrics.instability.toFixed(2)}
                </span>
                <span>
                  <em>Dead symbols</em> {file.metrics.deadSymbols}
                </span>
              </div>
              {file.penalties.length === 0 ? (
                <p className="health-findings__empty">No deductions — clean file.</p>
              ) : (
                <ul className="finding-list">
                  {file.penalties.map((penalty) => {
                    const nodeKey = penalty.symbol
                      ? symbolKey(file.path, penalty.symbol)
                      : fileKey(file.path);
                    return (
                      <li key={`${penalty.code}-${penalty.line ?? 0}-${penalty.symbol ?? ''}`}>
                        <span className="finding-list__code">{penalty.code.replaceAll('_', ' ')}</span>
                        <span className="finding-list__message">{penalty.message}</span>
                        {penalty.line ? (
                          <span className="finding-list__location">L{penalty.line}</span>
                        ) : null}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onLocate(nodeKey)}
                        >
                          show on map
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onExplain(nodeKey)}
                        >
                          explain
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function HealthDashboard({
  data,
  isLoading,
  error,
  onRetry,
  onLocate,
  onExplain,
}: {
  data: HealthPayload | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onLocate: (key: string) => void;
  onExplain: (key: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>('score');
  const [filter, setFilter] = useState('');
  const [onlyFindings, setOnlyFindings] = useState(false);

  const files = useMemo(() => {
    if (!data) return [];
    const query = filter.trim().toLowerCase();
    const filtered = data.files.filter((file) => {
      if (onlyFindings && file.penalties.length === 0) return false;
      return !query || file.path.toLowerCase().includes(query);
    });
    return filtered.sort((a, b) => {
      if (sort === 'path') return a.path.localeCompare(b.path);
      if (sort === 'complexity') return b.metrics.maxComplexity - a.metrics.maxComplexity;
      if (sort === 'loc') return b.metrics.loc - a.metrics.loc;
      return a.score - b.score || a.path.localeCompare(b.path);
    });
  }, [data, filter, onlyFindings, sort]);

  const stats = useMemo(() => {
    if (!data) return null;
    const findings = data.files.reduce((total, file) => total + file.penalties.length, 0);
    const hotspots = data.files.filter((file) => file.score < 70).length;
    const dead = data.files.filter((file) => file.metrics.deadCodeCandidate).length;
    return { findings, hotspots, dead };
  }, [data]);

  if (isLoading) {
    return (
      <div className="loading-block">
        <Spinner label="Scoring the codebase…" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorNotice
        error={{
          code: 'HEALTH_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Health report failed.',
        }}
        onRetry={onRetry}
      />
    );
  }

  if (!data) return <EmptyState title="No health data" description="Health scoring is available once the analysis completes." />;

  return (
    <div className="health">
      <div className="health__hero">
        <ScoreRing score={data.repoScore} label="health" size={150} />
        <div className="health__hero-copy">
          <h2>Codebase health</h2>
          <p>
            Explainable, symbol-aware scoring. Every deduction below maps to a file, a line and —
            where applicable — a symbol. Static heuristics only; no execution.
          </p>
          <div className="health__stats">
            <div>
              <strong>{data.files.length}</strong>
              <span>files scored</span>
            </div>
            <div>
              <strong>{formatNumber(stats?.findings ?? 0)}</strong>
              <span>findings</span>
            </div>
            <div>
              <strong>{stats?.hotspots ?? 0}</strong>
              <span>hotspots &lt; 70</span>
            </div>
            <div>
              <strong>{stats?.dead ?? 0}</strong>
              <span>dead files</span>
            </div>
          </div>
        </div>
      </div>

      <div className="health__toolbar">
        <div className="toolbar">
          <div className="toolbar__search">
            <Icon name="search" size={15} />
            <input
              className="input input--sm"
              placeholder="Filter by path…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={onlyFindings}
              onChange={(event) => setOnlyFindings(event.target.checked)}
            />
            Only files with findings
          </label>
          <label className="toolbar__select">
            <span>Sort</span>
            <select
              className="select select--sm"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="score">Lowest score</option>
              <option value="path">Path</option>
              <option value="complexity">Complexity</option>
              <option value="loc">Lines</option>
            </select>
          </label>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table health-table">
          <thead>
            <tr>
              <th>File</th>
              <th title="0–100">Score</th>
              <th>Symbols</th>
              <th title="Maximum estimated cyclomatic complexity">Max cplx</th>
              <th title="fan-in / fan-out">Coupling</th>
              <th>Flag</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <FileRow key={file.path} file={file} onLocate={onLocate} onExplain={onExplain} />
            ))}
          </tbody>
        </table>
        {files.length === 0 ? (
          <p className="table-empty">No files match this filter.</p>
        ) : null}
      </div>

      <p className="health__footnote">
        <Icon name="info" size={14} /> Score is the rounded average of per-file scores. Instability is
        Martin's <code>fanOut / (fanIn + fanOut)</code>; values near 1 mean the file depends on more
        than depends on it.
      </p>
    </div>
  );
}
