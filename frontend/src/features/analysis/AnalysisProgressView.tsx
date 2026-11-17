import type { Analysis, Repo } from '@/api/types';
import { Icon } from '@/components/Icon';
import { Badge, Button, ErrorNotice, ProgressBar } from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { friendlyMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';

const STAGES: Array<{
  status: Analysis['status'];
  label: string;
  description: string;
}> = [
  {
    status: 'queued',
    label: 'Queued',
    description: 'Waiting for a worker slot. Large repositories may sit here briefly.',
  },
  {
    status: 'fetching',
    label: 'Fetching',
    description: 'Validating metadata and cloning the repository at the selected branch.',
  },
  {
    status: 'parsing',
    label: 'Parsing',
    description: 'Parsing TypeScript, JavaScript and Python — symbols, imports and calls.',
  },
  {
    status: 'building_graph',
    label: 'Building graph',
    description: 'Assembling nodes and edges, embedding summaries and scoring health.',
  },
  { status: 'done', label: 'Done', description: 'The map is ready.' },
];

function stageState(
  stage: Analysis['status'],
  current: Analysis['status']
): 'done' | 'current' | 'pending' | 'failed' {
  if (current === 'failed') return stage === 'queued' ? 'current' : 'pending';
  if (stage === 'done') return current === 'done' ? 'done' : 'pending';
  const order = STAGES.map((entry) => entry.status);
  const stageIndex = order.indexOf(stage);
  const currentIndex = order.indexOf(current);
  if (stageIndex < currentIndex) return 'done';
  if (stageIndex === currentIndex) return 'current';
  return 'pending';
}

export function AnalysisProgressView({
  analysis,
  repo,
  onRetry,
  retrying,
  onBack,
  onOpenRepos,
}: {
  analysis: Analysis;
  repo: Repo | undefined;
  onRetry: () => void;
  retrying: boolean;
  onBack: () => void;
  onOpenRepos: () => void;
}) {
  const failed = analysis.status === 'failed';
  const done = analysis.status === 'done';

  return (
    <div className="progress-view">
      <div className="progress-view__card">
        <header className="progress-view__header">
          <div>
            <StatusBadge status={analysis.status} />
            <h2>
              {failed
                ? 'Analysis failed'
                : done
                  ? 'Analysis complete'
                  : 'Analyzing repository'}
            </h2>
            <p>
              {repo ? `${repo.owner}/${repo.name}` : 'Repository'} · started{' '}
              {formatRelative(analysis.createdAt)}
            </p>
          </div>
          <span className="progress-view__percent">{Math.round(analysis.progress)}%</span>
        </header>

        <ProgressBar
          value={analysis.progress}
          tone={failed ? 'red' : done ? 'green' : 'blue'}
          label="Analysis progress"
        />

        <ol className="stage-list">
          {STAGES.map((stage) => {
            const state = stageState(stage.status, analysis.status);
            return (
              <li key={stage.status} className={`stage stage--${state}`}>
                <span className="stage__marker" aria-hidden="true">
                  {state === 'done' ? (
                    <Icon name="check" size={14} />
                  ) : state === 'current' ? (
                    <span className="stage__pulse" />
                  ) : (
                    <span className="stage__dot" />
                  )}
                </span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.description}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {analysis.error ? (
          <ErrorNotice
            error={{
              code: analysis.error.code,
              message: friendlyMessage({
                code: analysis.error.code,
                message: analysis.error.message,
              }),
            }}
            compact
          />
        ) : null}

        {analysis.summary ? (
          <div className="summary-chips summary-chips--wide">
            <span>
              <strong>{analysis.summary.fileCount}</strong> files
            </span>
            <span>
              <strong>{analysis.summary.symbolCount}</strong> symbols
            </span>
            <span>
              <strong>{analysis.summary.cycleCount}</strong> cycles
            </span>
            <span>
              <strong>{analysis.summary.healthScore}</strong> health
            </span>
            {analysis.summary.diff ? (
              <>
                <span>
                  <strong>{analysis.summary.diff.reusedFiles}</strong> reused
                </span>
                <span>
                  <strong>{analysis.summary.diff.changedFiles}</strong> changed
                </span>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="progress-view__actions">
          {failed ? (
            <Button variant="primary" icon="refresh" loading={retrying} onClick={onRetry}>
              Retry analysis
            </Button>
          ) : null}
          <Button variant="ghost" icon="arrow-left" onClick={onBack}>
            Back to repository
          </Button>
          {failed ? (
            <Button variant="ghost" icon="repo" onClick={onOpenRepos}>
              All repositories
            </Button>
          ) : null}
        </div>

        <p className="progress-view__hint">
          <Icon name="info" size={14} /> Progress arrives live over Socket.io and falls back to
          polling. You can leave this page — the analysis keeps running server-side.
        </p>
      </div>
    </div>
  );
}

export function AnalysisFailedNotice({
  analysis,
  onRetry,
  retrying,
}: {
  analysis: Analysis;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="page">
      <ErrorNotice
        error={{
          code: analysis.error?.code ?? 'ANALYSIS_FAILED',
          message: analysis.error?.message ?? 'The analysis failed.',
        }}
        onRetry={onRetry}
      />
      {retrying ? <Badge tone="blue">retrying…</Badge> : null}
    </div>
  );
}
