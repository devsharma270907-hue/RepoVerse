import { env } from '../../config/env';
import { AppError } from '../../utils/appError';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { simpleGit } from 'simple-git';

/**
 * GitHub ingestion client (PRD §10.1) — metadata pre-checks happen BEFORE any
 * heavy work: existence, visibility, size. Untrusted repo content is never
 * fetched here; only GitHub API metadata.
 */
const GITHUB_API = 'https://api.github.com';

function apiHeaders(bearer?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'RepoVerse-Analyzer',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

/**
 * Credentials to try, most specific first.
 *
 * A user-supplied PAT must never be able to make a PUBLIC repo unreadable: a
 * fine-grained token scoped to the owner's own repositories returns 404 for
 * everyone else's code, and an expired/revoked one returns 401. Both used to
 * abort the request outright. Falling back to the server token and finally to
 * an anonymous read keeps public ingestion working in those cases, while a
 * private repo still fails closed (anonymous → 404).
 */
function tokenCandidates(token?: string): Array<string | undefined> {
  const candidates: Array<string | undefined> = [];
  if (token) candidates.push(token);
  if (env.GITHUB_TOKEN && env.GITHUB_TOKEN !== token) {
    candidates.push(env.GITHUB_TOKEN);
  }
  if (candidates.length > 0) candidates.push(undefined);
  return candidates.length > 0 ? candidates : [undefined];
}

function ghError(status: number): AppError {
  if (status === 404 || status === 401) {
    return new AppError(
      422,
      'REPO_NOT_ACCESSIBLE',
      'Repository not found, or private without a GitHub token with access'
    );
  }
  if (status === 403) {
    return new AppError(
      422,
      'REPO_NOT_ACCESSIBLE',
      'GitHub API rate limit reached — try again later, or connect a GitHub token'
    );
  }
  return new AppError(502, 'GITHUB_ERROR', `GitHub API error (${status})`);
}

/**
 * A 403 is ambiguous: it is both the quota response and GitHub's answer for a
 * token that exists but lacks permission. The quota one is identifiable from
 * the rate-limit headers/body, and the distinction decides whether the user
 * needs to wait, or needs a different token.
 */
async function errorFor(res: Response): Promise<AppError> {
  if (res.status !== 403) return ghError(res.status);

  const remaining = res.headers.get('x-ratelimit-remaining');
  let body = '';
  try {
    body = (await res.text()).slice(0, 400);
  } catch {
    // Body already consumed or unreadable — fall back to the headers.
  }

  if (remaining === '0' || /rate limit|abuse detection/i.test(body)) {
    return ghError(403);
  }
  return new AppError(
    422,
    'REPO_NOT_ACCESSIBLE',
    'GitHub denied access — the token is not valid or lacks permission for this repository'
  );
}

async function ghFetch<T>(path: string, token?: string): Promise<T> {
  // Only credential problems are retried; a 5xx or malformed response is final.
  let denied: AppError | null = null;

  for (const bearer of tokenCandidates(token)) {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}${path}`, {
        headers: apiHeaders(bearer),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logger.warn(
        'GitHub API unreachable',
        err instanceof Error ? err : new Error(String(err))
      );
      throw new AppError(503, 'GITHUB_UNAVAILABLE', 'GitHub API is unreachable');
    }

    if (res.ok) return (await res.json()) as T;

    if (res.status === 401 || res.status === 403 || res.status === 404) {
      denied = await errorFor(res);
      continue;
    }
    throw await errorFor(res);
  }

  throw denied ?? new AppError(502, 'GITHUB_ERROR', 'GitHub API error');
}

/** A repository surfaced by discovery — metadata only, never content. */
export interface DiscoveredRepo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  updatedAt: string;
}

export interface DiscoverReposResult {
  repos: DiscoveredRepo[];
  total: number;
}

interface GithubRepoItem {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
  owner: { login: string };
}

function mapGithubRepo(item: GithubRepoItem): DiscoveredRepo {
  return {
    id: item.id,
    owner: item.owner.login,
    name: item.name,
    fullName: item.full_name,
    description: item.description ?? null,
    url: item.html_url,
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language ?? null,
    isPrivate: item.private,
    defaultBranch: item.default_branch,
    updatedAt: item.updated_at,
  };
}

/**
 * Repository discovery (PRD §4.9 command palette / repo picker).
 *
 * Uses GitHub's search API so `owner` and free-text `q` can be combined and
 * a real `total_count` is returned. Only public metadata is read — clones
 * still go through the validated `fetchRepoMeta` + `cloneRepo` path.
 */
export async function discoverRepos(opts: {
  query?: string;
  owner?: string;
  page?: number;
  limit?: number;
  token?: string;
}): Promise<DiscoverReposResult> {
  const page = opts.page && opts.page > 0 ? Math.floor(opts.page) : 1;
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 20), 1), 50);

  const terms: string[] = [];
  if (opts.query?.trim()) terms.push(opts.query.trim());
  if (opts.owner?.trim()) terms.push(`user:${opts.owner.trim()}`);
  if (terms.length === 0) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      'Provide a search query (q), an owner, or both'
    );
  }

  const q = encodeURIComponent(terms.join(' '));
  const data = await ghFetch<{ total_count: number; items: GithubRepoItem[] }>(
    `/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}&page=${page}`,
    opts.token
  );

  return {
    repos: (data.items ?? []).map(mapGithubRepo),
    total: data.total_count ?? 0,
  };
}

export interface RepoMeta {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  sizeKb: number;
  isPrivate: boolean;
}

/** Fetch + validate repo metadata (size/visibility guards, PRD §10.1 step 2). */
export async function fetchRepoMeta(
  owner: string,
  name: string,
  token?: string
): Promise<RepoMeta> {
  const data = await ghFetch<{
    full_name: string;
    private: boolean;
    size: number; // KB
    default_branch: string;
    owner: { login: string };
    name: string;
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, token);

  if (data.private && !token) {
    throw new AppError(
      422,
      'REPO_NOT_ACCESSIBLE',
      'Repository is private — connect a GitHub token with access to analyze it'
    );
  }

  const sizeMb = data.size / 1024;
  if (sizeMb > env.REPO_MAX_SIZE_MB) {
    throw new AppError(
      413,
      'REPO_TOO_LARGE',
      `Repository is ${sizeMb.toFixed(0)}MB — exceeds the ${env.REPO_MAX_SIZE_MB}MB analysis limit`
    );
  }

  return {
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    sizeKb: data.size,
    isPrivate: data.private,
  };
}

export interface ClonedRepo {
  dir: string; // absolute path to the shallow clone workspace
  commitSha: string;
}

/**
 * Fetches ONE file's content from GitHub raw at a pinned commit (PRD §10.3 —
 * AI explanation is grounded in the symbol's source). Content is fetched on
 * demand and never persisted — the retention promise of PRD §10.5 holds.
 *
 * Security: `filePath` must be a relative posix path produced by our own
 * parser — traversal sequences are rejected before anything is requested.
 */
export async function fetchFileContent(
  owner: string,
  name: string,
  ref: string,
  filePath: string,
  token?: string
): Promise<string> {
  const posix = filePath.replace(/\\/g, '/');
  if (
    posix.includes('..') ||
    posix.startsWith('/') ||
    posix.split('/').some((segment) => segment.length === 0)
  ) {
    throw new AppError(400, 'INVALID_REQUEST', 'Invalid file path');
  }

  const encodedPath = posix.split('/').map(encodeURIComponent).join('/');

  // Same credential ladder as ghFetch: a connected PAT that cannot read this
  // repo must not make public source unreadable.
  let denied: AppError | null = null;
  try {
    for (const bearer of tokenCandidates(token)) {
      // Authenticated reads go through the contents API (raw.github 404s for
      // private repos); public reads keep using the cheaper raw endpoint.
      const url = bearer
        ? `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
        : `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(ref)}/${encodedPath}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'RepoVerse-Analyzer',
          ...(bearer
            ? { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${bearer}` }
            : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) return await res.text();

      if (bearer && (res.status === 401 || res.status === 403 || res.status === 404)) {
        denied = new AppError(
          404,
          'NODE_SOURCE_MISSING',
          'Source file no longer exists in the analyzed commit'
        );
        continue;
      }
      if (res.status === 404) {
        throw new AppError(
          404,
          'NODE_SOURCE_MISSING',
          'Source file no longer exists in the analyzed commit'
        );
      }
      throw new AppError(502, 'GITHUB_ERROR', `GitHub raw fetch error (${res.status})`);
    }

    throw denied ?? new AppError(502, 'GITHUB_ERROR', 'GitHub raw fetch failed');
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn(
      'GitHub raw fetch failed',
      err instanceof Error ? err : new Error(String(err))
    );
    throw new AppError(503, 'GITHUB_UNAVAILABLE', 'GitHub raw is unreachable');
  }
}

/**
 * Shallow-clone the repo into a per-analysis temp workspace (PRD §10.1).
 *
 * Security rules (PRD §12):
 *  - URL built ONLY from validated owner/name (githubUrl.ts) — no user URLs
 *  - `--depth 1 --single-branch --no-tags`: no history, no submodule recursion
 *    (hooks are never executed by clone)
 *  - hard time budget from simple-git + the pipeline-wide wall-clock timeout
 *  - caller MUST delete the workspace in a finally block (see pipeline.ts)
 */
export async function cloneRepo(
  owner: string,
  name: string,
  branch: string,
  token?: string
): Promise<ClonedRepo> {
  const tmpRoot = path.resolve(env.ANALYSIS_TMP_DIR);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = path.join(tmpRoot, `${owner}-${name}-${unique}`);
  const url = `https://github.com/${owner}/${name}.git`;

  const runClone = async (bearer?: string): Promise<string> => {
    // Never let git block on an interactive credential prompt: this runs
    // headless, so a missing prompt would hang until the time budget expires.
    let git = simpleGit({
      timeout: { block: env.ANALYSIS_TIMEOUT_SECONDS * 1000 },
    }).env('GIT_TERMINAL_PROMPT', '0');

    if (bearer) {
      // Private-repo auth WITHOUT putting the token in argv (visible to `ps`).
      // `http.extraheader` is passed through GIT_CONFIG_* env vars instead.
      const basic = Buffer.from(`x-access-token:${bearer}`).toString('base64');
      git = git
        .env('GIT_CONFIG_COUNT', '1')
        .env('GIT_CONFIG_KEY_0', 'http.extraheader')
        .env('GIT_CONFIG_VALUE_0', `AUTHORIZATION: basic ${basic}`);
    }

    await git.clone(url, dir, [
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      branch,
      '--no-tags',
    ]);
    const log = await git.cwd(dir).log({ maxCount: 1 });
    return log.latest?.hash ?? '';
  };

  try {
    let commitSha = '';
    try {
      commitSha = await runClone(token ?? env.GITHUB_TOKEN);
    } catch (err) {
      // Git credentials override the URL, so a connected PAT that cannot read
      // this repo (fine-grained scoped elsewhere, revoked, expired) turns a
      // public clone into a hard failure. Retry anonymously before giving up —
      // a private repo simply fails again, which is the correct outcome.
      const message = err instanceof Error ? err.message : String(err);
      const credentialFailure =
        /authentication|403|401|not found|could not read|invalid username or password/i.test(
          message
        );
      if (!credentialFailure) throw err;

      fs.rmSync(dir, { recursive: true, force: true });
      logger.warn(
        'Clone rejected the stored credential — retrying anonymously',
        err instanceof Error ? err : new Error(String(err))
      );
      commitSha = await runClone();
    }

    if (!commitSha) {
      throw new AppError(422, 'REPO_UNSUPPORTED_LANGUAGE', 'Repository has no commits');
    }
    return { dir, commitSha };
  } catch (err) {
    // Clean up on failed clone — never leave workspaces behind
    fs.rmSync(dir, { recursive: true, force: true });
    if (err instanceof AppError) throw err;
    logger.warn('Clone failed', err instanceof Error ? err : new Error(String(err)));
    throw new AppError(
      422,
      'REPO_NOT_ACCESSIBLE',
      `Could not clone repository (branch: ${branch})`
    );
  }
}
