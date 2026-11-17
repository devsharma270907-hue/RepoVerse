import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRepos } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Badge, Button, EmptyState, ErrorNotice, Spinner } from '@/components/ui';
import { AddRepoDialog } from '@/features/repos/AddRepoDialog';
import { formatBytesFromKb, formatDate, pluralize } from '@/lib/format';

export function ReposPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const reposQuery = useRepos(page);

  const repos = useMemo(() => {
    const items = reposQuery.data?.repos ?? [];
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter((repo) =>
      `${repo.owner}/${repo.name}`.toLowerCase().includes(query)
    );
  }, [reposQuery.data, filter]);

  const pagination = reposQuery.data?.pagination;
  const privateCount = useMemo(
    () => (reposQuery.data?.repos ?? []).filter((repo) => repo.isPrivate).length,
    [reposQuery.data]
  );

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="page repos-page">
      <header className="page__header">
        <div>
          <p className="page__eyebrow">Workspace</p>
          <h1>Repositories</h1>
          <p className="page__lede">
            Welcome back, {firstName}. Open a map or add a repository to analyze its dependency
            graph, health and blast radius.
          </p>
        </div>
        <div className="page__actions">
          <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
            Add repository
          </Button>
        </div>
      </header>

      {reposQuery.data && reposQuery.data.repos.length > 0 ? (
        <div className="stat-strip">
          <div className="stat-strip__item">
            <Icon name="repo" size={17} />
            <div>
              <strong>{pagination?.total ?? reposQuery.data.repos.length}</strong>
              <span>{pluralize(pagination?.total ?? reposQuery.data.repos.length, 'repository', 'repositories')}</span>
            </div>
          </div>
          <div className="stat-strip__item">
            <Icon name="lock" size={17} />
            <div>
              <strong>{privateCount}</strong>
              <span>private on this page</span>
            </div>
          </div>
          <div className="stat-strip__item">
            <Icon name="graph" size={17} />
            <div>
              <strong>Map · Health · Impact</strong>
              <span>available per analysis</span>
            </div>
          </div>
          <div className="stat-strip__spacer" />
          <div className="toolbar__search">
            <Icon name="search" size={15} />
            <input
              className="input input--sm"
              placeholder="Filter repositories…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      {reposQuery.isLoading ? (
        <div className="loading-block">
          <Spinner label="Loading repositories…" />
        </div>
      ) : reposQuery.error ? (
        <ErrorNotice
          error={{
            code: 'REPOS_UNAVAILABLE',
            message:
              reposQuery.error instanceof Error
                ? reposQuery.error.message
                : 'Could not load repositories.',
          }}
          onRetry={() => void reposQuery.refetch()}
        />
      ) : repos.length === 0 ? (
        <EmptyState
          icon="repo"
          title={
            reposQuery.data && reposQuery.data.repos.length > 0
              ? 'No repositories match this filter'
              : 'Analyze your first repository'
          }
          description={
            reposQuery.data && reposQuery.data.repos.length > 0
              ? 'Clear the filter to see all repositories.'
              : 'Paste a public GitHub URL and RepoVerse will clone it, parse the source, and build a navigable map. Nothing is installed and nothing is written back.'
          }
          action={
            reposQuery.data && reposQuery.data.repos.length > 0 ? (
              <Button variant="ghost" onClick={() => setFilter('')}>
                Clear filter
              </Button>
            ) : (
              <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
                Add your first repository
              </Button>
            )
          }
        />
      ) : (
        <div className="repo-grid">
          {repos.map((repo) => (
            <Link key={repo.id} to={`/repos/${repo.id}`} className="repo-card">
              <header className="repo-card__header">
                <span className="repo-card__avatar" aria-hidden="true">
                  {repo.owner.slice(0, 1).toUpperCase()}
                </span>
                <div className="repo-card__title">
                  <h2>
                    {repo.owner}
                    <span>/</span>
                    {repo.name}
                  </h2>
                  <p>
                    {repo.isPrivate ? (
                      <Badge tone="amber" icon="lock">
                        private
                      </Badge>
                    ) : (
                      <Badge tone="green">public</Badge>
                    )}
                    <Badge tone="gray">{repo.branch}</Badge>
                  </p>
                </div>
                <Icon name="chevron-right" size={17} className="repo-card__chevron" />
              </header>
              <dl className="repo-card__meta">
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytesFromKb(repo.sizeKb)}</dd>
                </div>
                <div>
                  <dt>Added</dt>
                  <dd>{formatDate(repo.createdAt)}</dd>
                </div>
                <div>
                  <dt>Default branch</dt>
                  <dd>{repo.defaultBranch ?? repo.branch}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <nav className="pagination" aria-label="Repository pages">
          <Button
            size="sm"
            variant="ghost"
            icon="arrow-left"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            iconRight="arrow-right"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </nav>
      ) : null}

      <AddRepoDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
