import request from 'supertest';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser } from './helpers/http';
import { discoverRepos } from '../src/services/analyzer/fetcher';

/**
 * GitHub repository discovery (PRD §4.9). All GitHub traffic is stubbed —
 * these tests never hit the network.
 */
beforeAll(startTestDB);
afterAll(stopTestDB);
afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEM = {
  id: 42,
  name: 'repoverse',
  full_name: 'octo/repoverse',
  description: 'Codebase intelligence',
  html_url: 'https://github.com/octo/repoverse',
  stargazers_count: 123,
  forks_count: 7,
  language: 'TypeScript',
  private: false,
  default_branch: 'main',
  updated_at: '2026-01-02T03:04:05Z',
  owner: { login: 'octo' },
};

function stubGithub(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('discoverRepos service', () => {
  it('searches repositories with q + owner and maps metadata', async () => {
    const fetchMock = stubGithub({ total_count: 1, items: [ITEM] });

    const result = await discoverRepos({
      query: 'code graph',
      owner: 'octo',
      page: 2,
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(result.repos[0]).toMatchObject({
      id: 42,
      owner: 'octo',
      name: 'repoverse',
      fullName: 'octo/repoverse',
      stars: 123,
      forks: 7,
      language: 'TypeScript',
      isPrivate: false,
      defaultBranch: 'main',
    });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/search/repositories?q=');
    expect(decodeURIComponent(url)).toContain('code graph');
    expect(decodeURIComponent(url)).toContain('user:octo');
    expect(url).toContain('per_page=10');
    expect(url).toContain('page=2');
  });

  it('rejects an empty discovery request', async () => {
    await expect(discoverRepos({})).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REQUEST',
    });
  });

  it('maps GitHub rate-limit responses to REPO_NOT_ACCESSIBLE', async () => {
    stubGithub({ message: 'API rate limit exceeded' }, 403);
    await expect(discoverRepos({ query: 'x' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'REPO_NOT_ACCESSIBLE',
    });
  });
});

describe('GET /api/v1/github/repos', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/github/repos?q=test');
    expect(res.status).toBe(401);
  });

  it('requires q or owner → 400 INVALID_REQUEST', async () => {
    const { accessToken } = await registerUser({
      name: 'G1',
      email: 'g1@t.dev',
      password: 'supersecret123',
    });
    const res = await request(app)
      .get('/api/v1/github/repos')
      .set(bearer(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns discovered repos with pagination', async () => {
    stubGithub({ total_count: 1, items: [ITEM] });
    const { accessToken } = await registerUser({
      name: 'G2',
      email: 'g2@t.dev',
      password: 'supersecret123',
    });

    const res = await request(app)
      .get('/api/v1/github/repos')
      .query({ q: 'repoverse', limit: 5 })
      .set(bearer(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.repos).toHaveLength(1);
    expect(res.body.data.repos[0].fullName).toBe('octo/repoverse');
    expect(res.body.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
  });
});
