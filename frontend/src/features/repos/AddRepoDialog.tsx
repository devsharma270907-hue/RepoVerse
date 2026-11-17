import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { discoverRepos } from '@/api/endpoints';
import { useRegisterRepo } from '@/api/hooks';
import type { GithubRepo } from '@/api/types';
import { Icon } from '@/components/Icon';
import {
  Badge,
  Button,
  ErrorNotice,
  Field,
  Input,
  Modal,
  Tabs,
} from '@/components/ui';
import { fieldError, friendlyMessage, toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';
import { isValidGitHubUrl } from '@/lib/githubUrl';
import { formatNumber, formatRelative } from '@/lib/format';

const repoSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Repository URL is required')
    .refine(
      isValidGitHubUrl,
      'Use a GitHub repository URL: https://github.com/<owner>/<repo>'
    ),
  branch: z.string().trim().max(100, 'Branch name is too long').optional(),
});

type RepoValues = z.infer<typeof repoSchema>;

export function AddRepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const registerRepo = useRegisterRepo();

  const [tab, setTab] = useState<'url' | 'discover'>('url');
  const [serverError, setServerError] = useState<AppError | null>(null);
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [discoveryError, setDiscoveryError] = useState<AppError | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<GithubRepo[]>([]);
  const [discoveryRan, setDiscoveryRan] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RepoValues>({
    resolver: zodResolver(repoSchema),
    defaultValues: { url: '', branch: '' },
  });

  useEffect(() => {
    if (!open) {
      setTab('url');
      setServerError(null);
      setDiscoveryQuery('');
      setDiscoveryError(null);
      setDiscoveryResults([]);
      setDiscoveryRan(false);
      registerRepo.reset();
    }
    // Reset only when the dialog opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const result = await registerRepo.mutateAsync({
        url: values.url,
        ...(values.branch?.trim() ? { branch: values.branch.trim() } : {}),
      });
      onClose();
      navigate(`/analyses/${result.analysisId}`);
    } catch (err) {
      setServerError(toAppError(err));
    }
  });

  const runDiscovery = async (): Promise<void> => {
    const query = discoveryQuery.trim();
    if (!query) return;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    setDiscoveryRan(true);
    try {
      const isOwnerShorthand = !query.includes(' ');
      const result = await discoverRepos({
        q: query,
        ...(isOwnerShorthand ? { owner: query } : {}),
        limit: 10,
      });
      setDiscoveryResults(result.repos);
    } catch (err) {
      setDiscoveryError(toAppError(err));
      setDiscoveryResults([]);
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const useRepo = (repo: GithubRepo): void => {
    setValue('url', repo.url, { shouldValidate: true });
    setTab('url');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Analyze a repository"
      description="Paste a public GitHub URL, or discover one. Private repositories require a connected token in Settings."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {tab === 'url' ? (
            <Button
              variant="primary"
              icon="sparkles"
              loading={registerRepo.isPending}
              onClick={() => void onSubmit()}
            >
              Analyze repository
            </Button>
          ) : null}
        </>
      }
    >
      <Tabs
        tabs={[
          { id: 'url', label: 'Paste URL', icon: 'link' },
          { id: 'discover', label: 'Discover on GitHub', icon: 'search' },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Repository input mode"
      />

      {tab === 'url' ? (
        <form className="stack" onSubmit={onSubmit} noValidate>
          {serverError ? <ErrorNotice error={serverError} compact /> : null}

          <Field
            label="GitHub repository URL"
            htmlFor="repo-url"
            hint="Only github.com is accepted — the server re-validates before fetching."
            error={errors.url?.message ?? fieldError(serverError, 'url')}
          >
            <Input
              id="repo-url"
              placeholder="https://github.com/vercel/next.js"
              autoFocus
              spellCheck={false}
              {...register('url')}
            />
          </Field>

          <Field
            label="Branch"
            htmlFor="repo-branch"
            optional
            hint="Defaults to the repository's default branch."
            error={errors.branch?.message ?? fieldError(serverError, 'branch')}
          >
            <Input id="repo-branch" placeholder="main" spellCheck={false} {...register('branch')} />
          </Field>

          <div className="callout">
            <Icon name="info" size={16} />
            <p>
              Ingestion is read-only. RepoVerse never commits to the repository and never stores
              full source files — only derived graph data.
            </p>
          </div>
        </form>
      ) : (
        <div className="stack">
          <div className="discover-search">
            <Input
              placeholder="Search repositories or an owner, e.g. vercel"
              value={discoveryQuery}
              spellCheck={false}
              onChange={(event) => setDiscoveryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runDiscovery();
                }
              }}
            />
            <Button
              variant="secondary"
              icon="search"
              loading={discoveryLoading}
              onClick={() => void runDiscovery()}
            >
              Search
            </Button>
          </div>

          {discoveryError ? (
            <ErrorNotice
              error={{
                ...discoveryError,
                message: friendlyMessage(discoveryError),
              }}
              compact
            />
          ) : null}

          {discoveryLoading ? (
            <div className="loading-block loading-block--compact">
              <span className="spinner" aria-hidden="true" /> Searching GitHub…
            </div>
          ) : discoveryResults.length > 0 ? (
            <ul className="discover-list">
              {discoveryResults.map((repo) => (
                <li key={repo.id} className="discover-item">
                  <div className="discover-item__main">
                    <div className="discover-item__title">
                      <strong>{repo.fullName}</strong>
                      {repo.isPrivate ? <Badge tone="amber">private</Badge> : null}
                      {repo.language ? <Badge tone="blue">{repo.language}</Badge> : null}
                    </div>
                    <p>{repo.description ?? 'No description.'}</p>
                    <span className="discover-item__meta">
                      <Icon name="sparkles" size={12} /> {formatNumber(repo.stars)} stars · updated{' '}
                      {formatRelative(repo.updatedAt)}
                    </span>
                  </div>
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => useRepo(repo)}>
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          ) : discoveryRan ? (
            <p className="muted">No repositories found for “{discoveryQuery}”.</p>
          ) : (
            <p className="muted">
              Discovery uses the GitHub API. Without a server token the rate limit is low — connect
              your own token in Settings for reliable results.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
