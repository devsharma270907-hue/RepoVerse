import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';
import { User } from '../src/modules/users/user.model';
import { Repo } from '../src/modules/repos/repo.model';
import { Analysis } from '../src/modules/analyses/analysis.model';
import { GraphNode } from '../src/modules/graph/graphNode.model';
import { SavedView } from '../src/modules/workspace/savedView.model';
import { PinnedFinding } from '../src/modules/workspace/pinnedFinding.model';
import { LoginAttempt } from '../src/modules/auth/loginAttempt.model';

vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

beforeAll(startTestDB);
afterAll(stopTestDB);

const password = 'supersecret123';

interface AccountFixture {
  id: string;
  token: string;
  cookies: string[];
  repoId: string;
  analysisId: string;
  viewId: string;
  pinId: string;
}

async function createAccountWithWorkspace(
  name: string,
  email: string
): Promise<AccountFixture> {
  const reg = await registerUser({ name, email, password });
  const me = await request(app)
    .get('/api/v1/users/me')
    .set(bearer(reg.accessToken));
  const id = me.body.data.user.id as string;

  const repo = await request(app)
    .post('/api/v1/repos')
    .set(bearer(reg.accessToken))
    .send({ url: 'https://github.com/octocat/hello-world' });
  const repoId = repo.body.data.repo.id as string;
  const analysisId = repo.body.data.analysis.id as string;
  await waitForAnalysis(analysisId, reg.accessToken);

  const view = await request(app)
    .post(`/api/v1/repos/${repoId}/views`)
    .set(bearer(reg.accessToken))
    .send({
      name: `${name} view`,
      state: { level: 'file', highlightedNodes: ['file:a.ts'] },
    });
  const viewId = view.body.data.view.id as string;

  const pin = await request(app)
    .post(`/api/v1/analyses/${analysisId}/pins`)
    .set(bearer(reg.accessToken))
    .send({ nodeKey: 'file:a.ts', note: `${name} note` });
  const pinId = pin.body.data.pin.id as string;

  return {
    id,
    token: reg.accessToken,
    cookies: reg.cookies,
    repoId,
    analysisId,
    viewId,
    pinId,
  };
}

describe('GET /users/me/export (GDPR)', () => {
  it('exports owned metadata with a download header and no secrets', async () => {
    const account = await createAccountWithWorkspace(
      'Exporter',
      'export@test.dev'
    );

    const res = await request(app)
      .get('/api/v1/users/me/export')
      .set(bearer(account.token));

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('repoverse-export-');

    const { data } = res.body;
    expect(data).toMatchObject({
      formatVersion: 1,
      user: { id: account.id, email: 'export@test.dev' },
    });
    expect(data.repos.map((r: { id: string }) => r.id)).toContain(
      account.repoId
    );
    expect(data.analyses.map((a: { id: string }) => a.id)).toContain(
      account.analysisId
    );
    expect(data.savedViews.map((v: { name: string }) => v.name)).toContain(
      'Exporter view'
    );
    expect(
      data.pinnedFindings.map((p: { nodeKey: string }) => p.nodeKey)
    ).toContain('file:a.ts');

    // Portability must never export credentials or session material
    const serialized = JSON.stringify(res.body);
    for (const forbidden of [
      'passwordHash',
      'refreshTokens',
      'tokenHash',
      'ciphertext',
      'githubToken',
      'accessToken',
      'refreshToken',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/users/me/export');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('DELETE /users/me', () => {
  it('rejects a missing or wrong confirmation phrase → 400', async () => {
    const { accessToken } = await registerUser({
      name: 'No Confirm',
      email: 'no-confirm@test.dev',
      password,
    });

    const missing = await request(app)
      .delete('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.fields).toHaveProperty('confirmation');

    const wrong = await request(app)
      .delete('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ confirmation: 'delete my account' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hard-deletes the account and every derived record, leaving others intact', async () => {
    const target = await createAccountWithWorkspace(
      'Delete Me',
      'delete-me@test.dev'
    );
    const bystander = await createAccountWithWorkspace(
      'Bystander',
      'bystander@test.dev'
    );

    // Failed-login counter tied to the target email — must be erased too
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'delete-me@test.dev', password: 'wrong-password' });
    expect(await LoginAttempt.countDocuments({ email: 'delete-me@test.dev' })).toBe(1);

    const del = await request(app)
      .delete('/api/v1/users/me')
      .set(bearer(target.token))
      .send({ confirmation: 'DELETE MY ACCOUNT' });

    expect(del.status).toBe(200);
    expect((del.headers['set-cookie'][0] as string)).toContain(
      'refresh_token=;'
    );

    // Target: fully erased
    expect(await User.findById(target.id)).toBeNull();
    expect(await Repo.countDocuments({ userId: target.id })).toBe(0);
    expect(await Analysis.countDocuments({ userId: target.id })).toBe(0);
    expect(await GraphNode.countDocuments({ userId: target.id })).toBe(0);
    expect(await SavedView.countDocuments({ userId: target.id })).toBe(0);
    expect(await PinnedFinding.countDocuments({ userId: target.id })).toBe(0);
    expect(
      await LoginAttempt.countDocuments({ email: 'delete-me@test.dev' })
    ).toBe(0);

    // Bystander: untouched
    expect(await Repo.countDocuments({ userId: bystander.id })).toBe(1);
    expect(await SavedView.countDocuments({ userId: bystander.id })).toBe(1);
    expect(await PinnedFinding.countDocuments({ userId: bystander.id })).toBe(1);

    // Existing access token and refresh session are dead
    const me = await request(app)
      .get('/api/v1/users/me')
      .set(bearer(target.token));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('TOKEN_INVALID');

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', target.cookies);
    expect(refresh.status).toBe(401);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'delete-me@test.dev', password });
    expect(login.status).toBe(401);
    expect(login.body.error.message).toBe('Invalid email or password');
  });
});
