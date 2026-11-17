import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchRepoMeta } from '../src/services/analyzer/fetcher';

/**
 * Credential fallback for GitHub reads.
 *
 * A connected PAT is used first, but it must never make a public repo
 * unreadable: a fine-grained token scoped to the owner's own repositories
 * answers 404 for everyone else's code, and a revoked one answers 401. Both
 * used to abort the request, which surfaced as REPO_NOT_ACCESSIBLE even though
 * the repo was public and the server token was configured.
 */

const META = {
  full_name: 'Hackotber-26/T05-Team-ROX',
  private: false,
  size: 192,
  default_branch: 'main',
  owner: { login: 'Hackotber-26' },
  name: 'T05-Team-ROX',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Records the Authorization header of every attempt. */
function stubFetch(
  auths: Array<string | null>,
  respond: (auth: string | null, call: number) => Response
): void {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? null;
    auths.push(auth);
    return respond(auth, auths.length);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ghFetch credential fallback', () => {
  it('retries anonymously when the user token is rejected', async () => {
    const auths: Array<string | null> = [];
    stubFetch(auths, (auth) =>
      auth ? jsonResponse({ message: 'Bad credentials' }, 401) : jsonResponse(META)
    );

    const meta = await fetchRepoMeta('Hackotber-26', 'T05-Team-ROX', 'github_pat_scoped_elsewhere');

    expect(meta.fullName).toBe('Hackotber-26/T05-Team-ROX');
    expect(auths).toHaveLength(2);
    expect(auths[0]).toBe('Bearer github_pat_scoped_elsewhere');
    expect(auths[1]).toBeNull();
  });

  it('retries anonymously on a 404 caused by an over-scoped token', async () => {
    const auths: Array<string | null> = [];
    stubFetch(auths, (auth) =>
      auth ? jsonResponse({ message: 'Not Found' }, 404) : jsonResponse(META)
    );

    await expect(
      fetchRepoMeta('Hackotber-26', 'T05-Team-ROX', 'github_pat_narrow')
    ).resolves.toMatchObject({ owner: 'Hackotber-26' });
  });

  it('reports the rate-limit cause when every attempt is throttled', async () => {
    const auths: Array<string | null> = [];
    stubFetch(auths, () => jsonResponse({ message: 'API rate limit exceeded' }, 403));

    await expect(
      fetchRepoMeta('Hackotber-26', 'T05-Team-ROX', 'ghp_token')
    ).rejects.toThrow(/rate limit/i);
    // user token → anonymous
    expect(auths).toHaveLength(2);
  });

  it('distinguishes a permission 403 from a quota 403', async () => {
    const auths: Array<string | null> = [];
    stubFetch(auths, () =>
      jsonResponse({ message: 'Resource not accessible by personal access token' }, 403)
    );

    await expect(fetchRepoMeta('o', 'r', 'ghp_token')).rejects.toThrow(
      /denied access/i
    );
  });

  it('does not retry a server error', async () => {    const auths: Array<string | null> = [];
    stubFetch(auths, () => jsonResponse({ message: 'boom' }, 500));

    await expect(
      fetchRepoMeta('o', 'r', 'ghp_token')
    ).rejects.toThrow(/GitHub API error \(500\)/);
    expect(auths).toHaveLength(1);
  });

  it('fails closed for a private repo the credentials cannot read', async () => {
    const auths: Array<string | null> = [];
    stubFetch(auths, (auth) =>
      auth ? jsonResponse({ message: 'Not Found' }, 404) : jsonResponse({ message: 'Not Found' }, 404)
    );

    await expect(fetchRepoMeta('o', 'private-repo', 'ghp_token')).rejects.toThrow(
      /not found/i
    );
  });
});
