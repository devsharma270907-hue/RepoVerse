import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';
import { lastFetcherTokens, resetCloneControl } from './helpers/cloneControl';
import { User } from '../src/modules/users/user.model';
import { decrypt, encrypt } from '../src/utils/encryption';

// Offline pipeline double — no real GitHub API/clone calls
vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

const VALID_TOKEN = `ghp_${'A'.repeat(30)}a1b2`;
const fetchMock = vi.fn();

beforeAll(async () => {
  await startTestDB();
});

afterAll(async () => {
  await stopTestDB();
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCloneControl();
});

function githubAccepts(scopes = 'repo, read:user'): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ login: 'octocat' }), {
      status: 200,
      headers: { 'x-oauth-scopes': scopes },
    })
  );
}

describe('AES-256-GCM encryption (blueprint Section 6)', () => {
  it('round-trips and uses a unique IV per encryption', () => {
    const a = encrypt('ghp_secret_token_value');
    const b = encrypt('ghp_secret_token_value');

    expect(decrypt(a)).toBe('ghp_secret_token_value');
    expect(a.ciphertext).not.toContain('ghp_');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('detects tampering via the GCM auth tag', () => {
    const payload = encrypt('ghp_secret_token_value');
    const tampered = {
      ...payload,
      tag: `${payload.tag.slice(0, -2)}${payload.tag.endsWith('AA') ? 'BB' : 'AA'}`,
    };
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('GitHub PAT endpoints (private repos)', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/github-token')
      .send({ token: VALID_TOKEN });
    expect(res.status).toBe(401);
  });

  it('rejects malformed tokens before any network call → 400', async () => {
    const { accessToken } = await registerUser({
      name: 'Pat Bad',
      email: 'patbad@t.dev',
      password: 'supersecret123',
    });
    const res = await request(app)
      .put('/api/v1/users/me/github-token')
      .set(bearer(accessToken))
      .send({ token: 'not-a-github-token' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token GitHub refuses → 422, nothing stored', async () => {
    const { accessToken } = await registerUser({
      name: 'Pat Reject',
      email: 'patreject@t.dev',
      password: 'supersecret123',
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    );

    const res = await request(app)
      .put('/api/v1/users/me/github-token')
      .set(bearer(accessToken))
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GITHUB_TOKEN_INVALID');

    const stored = await User.findOne({ email: 'patreject@t.dev' })
      .select('+githubToken')
      .lean();
    expect(stored?.githubToken).toBeUndefined();
  });

  it('stores the token encrypted and returns only a hint', async () => {
    const { accessToken } = await registerUser({
      name: 'Pat Ok',
      email: 'patok@t.dev',
      password: 'supersecret123',
    });
    githubAccepts();

    const res = await request(app)
      .put('/api/v1/users/me/github-token')
      .set(bearer(accessToken))
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.data.githubToken).toMatchObject({
      connected: true,
      hint: '••••a1b2',
      scopes: ['repo', 'read:user'],
    });
    // The raw token must never appear in any response
    expect(JSON.stringify(res.body)).not.toContain(VALID_TOKEN);

    const user = await User.findOne({ email: 'patok@t.dev' })
      .select('+githubToken')
      .lean();
    const stored = user?.githubToken;
    expect(stored).toBeTruthy();
    expect(stored!.ciphertext).not.toContain(VALID_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(VALID_TOKEN);
    expect(decrypt(stored!)).toBe(VALID_TOKEN); // decryptable by the server only

    // GET /users/me exposes connection status, never ciphertext material
    const me = await request(app).get('/api/v1/users/me').set(bearer(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.githubToken).toMatchObject({
      connected: true,
      hint: '••••a1b2',
      scopes: ['repo', 'read:user'],
    });
    const meJson = JSON.stringify(me.body);
    expect(meJson).not.toContain(VALID_TOKEN);
    expect(meJson).not.toContain(stored!.ciphertext);
    expect(meJson).not.toContain(stored!.iv);
    expect(meJson).not.toContain(stored!.tag);
  });

  it('disconnects the stored token', async () => {
    const { accessToken } = await registerUser({
      name: 'Pat Del',
      email: 'patdel@t.dev',
      password: 'supersecret123',
    });
    githubAccepts();
    await request(app)
      .put('/api/v1/users/me/github-token')
      .set(bearer(accessToken))
      .send({ token: VALID_TOKEN });

    const del = await request(app)
      .delete('/api/v1/users/me/github-token')
      .set(bearer(accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.githubToken).toEqual({ connected: false });

    const user = await User.findOne({ email: 'patdel@t.dev' })
      .select('+githubToken')
      .lean();
    expect(user?.githubToken).toBeUndefined();

    const me = await request(app).get('/api/v1/users/me').set(bearer(accessToken));
    expect(me.body.data.user.githubToken).toEqual({ connected: false });
  });

  it('unlocks private repos end to end and passes the PAT to GitHub calls', async () => {
    const { accessToken } = await registerUser({
      name: 'Pat Private',
      email: 'patprivate@t.dev',
      password: 'supersecret123',
    });
    const url = 'https://github.com/octocat/private-repo';

    // Without a PAT the repo is inaccessible (422), as GitHub would answer
    const denied = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url });
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('REPO_NOT_ACCESSIBLE');
    expect(lastFetcherTokens().meta).toBeUndefined();

    // Connect a PAT, then the same repo analyzes successfully
    githubAccepts();
    const connect = await request(app)
      .put('/api/v1/users/me/github-token')
      .set(bearer(accessToken))
      .send({ token: VALID_TOKEN });
    expect(connect.status).toBe(200);

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url });
    expect(reg.status).toBe(202);
    expect(reg.body.data.repo.isPrivate).toBe(true);

    const { status, body } = await waitForAnalysis(
      reg.body.data.analysis.id,
      accessToken
    );
    expect(status).toBe('done');
    expect(body.summary).toMatchObject({ fileCount: 6, cycleCount: 1 });

    // The decrypted PAT reached BOTH metadata and clone calls
    expect(lastFetcherTokens()).toEqual({
      meta: VALID_TOKEN,
      clone: VALID_TOKEN,
    });
  });
});
