import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { downloadReport } from '@/api/endpoints';
import {
  useDeleteRepo,
  useDeleteView,
  useRefreshRepo,
  useRepo,
  useRepoAnalyses,
  useUpdateView,
  useViews,
} from '@/api/hooks';
import { Icon } from '@/components/Icon';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Modal,
  ProgressBar,
  Spinner,
} from '@/components/ui';
import { StatusBadge } from '@/components/StatusBadge';
import { formatBytesFromKb, formatDate, formatRelative, shortSha } from '@/lib/format';
import { friendlyMessage, toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';
import { downloadBlob } from '@/lib/download';

export function RepoPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const repoQuery = useRepo(repoId);
  const analysesQuery = useRepoAnalyses(repoId);
  const viewsQuery = useViews(repoId, true);
  const refresh = useRefreshRepo();
  const remove = useDeleteRepo();
  const updateView = useUpdateView(repoId);
  const removeView = useDeleteView(repoId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const repo = repoQuery.data;
  const analyses = analysesQuery.data?.analyses ?? [];
  const latest = analyses[0];
  const latestDone = useMemo(() => analyses.find((analysis) => analysis.status === 'done'), [analyses]);
  const views = viewsQuery.data ?? [];

  const startRefresh = async (): Promise<void> => {
    if (!repoId) return;
    setActionError(null);
    try {
      const result = await refresh.mutateAsync(repoId);
      navigate(`/analyses/${result.analysisId}`);
    } catch (err) {
      setActionError(toAppError(err));
    }
  };

  const downloadLatestReport = async (): Promise<void> => {
    if (!latest) return;
    setActionError(null);
    try {
      const blob = await downloadReport(latest.id);
      downloadBlob(blob, `repoverse-${latest.id}.md`);
    } catch (err) {
      setActionError(toAppError(err));
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!repoId) return;
    setActionError(null);
    try {
      await remove.mutateAsync(repoId);
      navigate('/', { replace: true });
    } catch (err) {
      setActionError(toAppError(err));
      setConfirmDelete(false);
    }
  };

  if (repoQuery.isLoading) {
    return (
      <div className="loading-block">
        <Spinner label="Loading repository…" />
      </div>
    );
  }

  if (repoQuery.error || !repo) {
    return (
      <div className="page">
        <ErrorNotice
          error={{
            code: 'REPO_UNAVAILABLE',
            message:
              repoQuery.error instanceof Error
                ? repoQuery.error.message
                : 'Repository not found.',
          }}
          onRetry={() => void repoQuery.refetch()}
        />
        <Button variant="ghost" icon="arrow-left" onClick={() => navigate('/')}>
          Back to repositories
        </Button>
      </div>
    );
  }

  return (
    <div className="page repo-page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Repositories</Link>
        <Icon name="chevron-right" size={13} />
        <span>
          {repo.owner}/{repo.name}
        </span>
      </nav>

      <header className="repo-header">
        <div className="repo-header__identity">
          <span className="repo-header__avatar" aria-hidden="true">
            {repo.owner.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1>
              {repo.owner}
              <span className="repo-header__slash">/</span>
              {repo.name}
            </h1>
            <div className="repo-header__badges">
              {repo.isPrivate ? (
                <Badge tone="amber" icon="lock">
                  private
                </Badge>
              ) : (
                <Badge tone="green">public</Badge>
              )}
              <Badge tone="gray" icon="github">
                {repo.branch}
              </Badge>
              <a
                className="link-button"
                href={repo.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on GitHub <Icon name="external" size={12} />
              </a>
            </div>
          </div>
        </div>
        <div className="page__actions">
          {latestDone ? (
            <Button
              variant="secondary"
              icon="graph"
              onClick={() => navigate(`/analyses/${latestDone.id}`)}
            >
              Open map
            </Button>
          ) : null}
          <Button
            variant="primary"
            icon="refresh"
            loading={refresh.isPending}
            onClick={() => void startRefresh()}
          >
            {latest ? 'Re-analyze' : 'Start analysis'}
          </Button>
          <Button
            variant="ghost"
            icon="trash"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete repository"
          />
        </div>
      </header>

      {actionError ? (
        <ErrorNotice error={{ ...actionError, message: friendlyMessage(actionError) }} />
      ) : null}

      <div className="repo-layout">
        <div className="repo-layout__main">
          <Card
            title="Latest analysis"
            subtitle={latest ? `Started ${formatRelative(latest.createdAt)}` : 'No analyses yet'}
            actions={
              latest ? (
                <Link className="btn btn--ghost btn--sm" to={`/analyses/${latest.id}`}>
                  Open workspace <Icon name="arrow-right" size={15} />
                </Link>
              ) : null
            }
          >
            {analysesQuery.isLoading ? (
              <div className="loading-block loading-block--compact">
                <Spinner /> Loading analyses…
              </div>
            ) : analysesQuery.error ? (
              <ErrorNotice
                error={{
                  code: 'ANALYSES_UNAVAILABLE',
                  message:
                    analysesQuery.error instanceof Error
                      ? analysesQuery.error.message
                      : 'Could not load analyses.',
                }}
                onRetry={() => void analysesQuery.refetch()}
                compact
              />
            ) : !latest ? (
              <EmptyState
                icon="graph"
                title="Nothing analyzed yet"
                description="Start the first analysis to clone, parse and map this repository."
                action={
                  <Button variant="primary" icon="refresh" onClick={() => void startRefresh()}>
                    Start analysis
                  </Button>
                }
              />
            ) : (
              <div className="latest-analysis">
                <div className="latest-analysis__top">
                  <StatusBadge status={latest.status} />
                  {latest.commitSha ? (
                    <Badge tone="gray" icon="code">
                      {shortSha(latest.commitSha)}
                    </Badge>
                  ) : null}
                  <span className="latest-analysis__time">{formatDate(latest.createdAt)}</span>
                </div>
                {latest.status !== 'done' && latest.status !== 'failed' ? (
                  <div className="latest-analysis__progress">
                    <ProgressBar value={latest.progress} label="Analysis progress" />
                    <span>{latest.progress}%</span>
                  </div>
                ) : null}
                {latest.error ? (
                  <ErrorNotice
                    error={{ code: latest.error.code, message: latest.error.message }}
                    compact
                  />
                ) : null}
                {latest.summary ? (
                  <div className="summary-chips">
                    <span>
                      <strong>{latest.summary.fileCount}</strong> files
                    </span>
                    <span>
                      <strong>{latest.summary.symbolCount}</strong> symbols
                    </span>
                    <span>
                      <strong>{latest.summary.cycleCount}</strong> cycles
                    </span>
                    <span>
                      <strong>{latest.summary.healthScore}</strong> health
                    </span>
                    {latest.summary.diff ? (
                      <span>
                        <strong>{latest.summary.diff.changedFiles}</strong> changed files
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="latest-analysis__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    icon="graph"
                    onClick={() => navigate(`/analyses/${latest.id}`)}
                  >
                    Open workspace
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="download"
                    onClick={() => void downloadLatestReport()}
                  >
                    Markdown report
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Analysis history" subtitle="Newest first — every run is commit-scoped." flush>
            {analyses.length === 0 ? (
              <p className="muted muted--pad">No runs yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Commit</th>
                      <th>Status</th>
                      <th>Files</th>
                      <th>Health</th>
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {analyses.map((analysis) => (
                      <tr key={analysis.id}>
                        <td>{formatRelative(analysis.createdAt)}</td>
                        <td>
                          <code>{shortSha(analysis.commitSha)}</code>
                        </td>
                        <td>
                          <StatusBadge status={analysis.status} />
                        </td>
                        <td>{analysis.summary?.fileCount ?? '—'}</td>
                        <td>{analysis.summary?.healthScore ?? '—'}</td>
                        <td>
                          <Link className="link-button" to={`/analyses/${analysis.id}`}>
                            open <Icon name="chevron-right" size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="repo-layout__side">
          <Card title="Repository details">
            <dl className="detail-list">
              <div>
                <dt>Default branch</dt>
                <dd>{repo.defaultBranch ?? repo.branch}</dd>
              </div>
              <div>
                <dt>Analyzed branch</dt>
                <dd>{repo.branch}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytesFromKb(repo.sizeKb)}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{formatDate(repo.createdAt)}</dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd>
                  <a href={repo.url} target="_blank" rel="noreferrer noopener">
                    {repo.url.replace('https://github.com/', '')}
                  </a>
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            title="Saved views"
            subtitle="Map state you can return to."
            actions={
              latestDone ? (
                <Badge tone="gray">{views.length}</Badge>
              ) : null
            }
          >
            {viewsQuery.isLoading ? (
              <div className="loading-block loading-block--compact">
                <Spinner />
              </div>
            ) : views.length === 0 ? (
              <p className="muted">
                No saved views yet. Open the workspace and save the current map state.
              </p>
            ) : (
              <ul className="saved-view-list">
                {views.map((view) => (
                  <li key={view.id} className="saved-view">
                    <div className="saved-view__main">
                      <strong>
                        {view.isPinned ? <Icon name="pin" size={12} /> : null} {view.name}
                      </strong>
                      <span>
                        {view.state.level} · {view.state.highlightedNodes.length} highlights ·{' '}
                        {formatRelative(view.updatedAt)}
                      </span>
                    </div>
                    <div className="saved-view__actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          updateView.mutate({ viewId: view.id, isPinned: !view.isPinned })
                        }
                      >
                        {view.isPinned ? 'unpin' : 'pin'}
                      </button>
                      {latestDone ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() =>
                            navigate(`/analyses/${latestDone.id}?viewId=${view.id}`)
                          }
                        >
                          open
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="link-button link-button--danger"
                        onClick={() => removeView.mutate(view.id)}
                      >
                        delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this repository?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep repository
            </Button>
            <Button
              variant="danger"
              icon="trash"
              loading={remove.isPending}
              onClick={() => void confirmRemove()}
            >
              Delete repository
            </Button>
          </>
        }
      >
        <p>
          This soft-deletes <strong>{repo.owner}/{repo.name}</strong> and hides its analyses. Adding
          the same URL later restores the record. Derived data is not shared with anyone.
        </p>
      </Modal>
    </div>
  );
}
