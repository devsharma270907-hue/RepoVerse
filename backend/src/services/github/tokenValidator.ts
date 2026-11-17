import { AppError } from '../../utils/appError';
import { logger } from '../../utils/logger';

/**
 * Verifies a user-supplied GitHub PAT against the API BEFORE it is stored —
 * so "connected" always means GitHub accepted the token. The raw token is
 * never logged; failures are reported with generic, actionable messages.
 */

const GITHUB_API = 'https://api.github.com';

export interface GithubTokenIdentity {
  login: string;
  scopes: string[]; // classic PATs report scopes; fine-grained tokens may not
}

export async function verifyGithubToken(token: string): Promise<GithubTokenIdentity> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RepoVerse-Analyzer',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn(
      'GitHub token verification failed to reach the API',
      err instanceof Error ? err : new Error(String(err))
    );
    throw new AppError(503, 'GITHUB_UNAVAILABLE', 'GitHub API is unreachable — try again');
  }

  if (res.status === 401) {
    throw new AppError(
      422,
      'GITHUB_TOKEN_INVALID',
      'GitHub rejected this token — check that it is valid and not expired'
    );
  }
  if (res.status === 403) {
    throw new AppError(
      422,
      'GITHUB_TOKEN_INVALID',
      'GitHub refused this token — check its permissions'
    );
  }
  if (!res.ok) {
    throw new AppError(502, 'GITHUB_ERROR', `GitHub API error (${res.status})`);
  }

  const body = (await res.json()) as { login?: string };
  const scopes = (res.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { login: body.login ?? 'unknown', scopes };
}
