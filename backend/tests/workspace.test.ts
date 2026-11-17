import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';

vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

beforeAll(startTestDB);
afterAll(stopTestDB);

const REPO_URL = 'https://github.com/octocat/hello-world';

/** Registers a user + analyzed repo — workspace features need a done analysis. */
async function setupWorkspace(email: string): Promise<{
  token: string;
  repoId: string;
  analysisId: string;
}> {
  const { accessToken } = await registerUser({
    name: 'Workspace User',
    email,
    password: 'supersecret123',
  });

  const reg = await request(app)
    .post('/api/v1/repos')
    .set(bearer(accessToken))
    .send({ url: REPO_URL });

  const repoId = reg.body.data.repo.id as string;
  const analysisId = reg.body.data.analysis.id as string;
  const finished = await waitForAnalysis(analysisId, accessToken);
  expect(finished.status).toBe('done');

  return { token: accessToken, repoId, analysisId };
}

describe('saved views', () => {
  it('creates, lists, updates and soft-deletes a view', async () => {
    const { token, repoId } = await setupWorkspace('views@test.dev');

    const create = await request(app)
      .post(`/api/v1/repos/${repoId}/views`)
      .set(bearer(token))
      .send({
        name: 'Critical path',
        description: 'Everything around a.ts',
        state: {
          level: 'file',
          searchQuery: 'a',
          highlightedNodes: ['file:a.ts'],
          filterKinds: ['file'],
        },
        isPinned: true,
      });
    expect(create.status).toBe(201);
    const viewId = create.body.data.view.id as string;
    expect(create.body.data.view).toMatchObject({
      name: 'Critical path',
      isPinned: true,
      state: { level: 'file', highlightedNodes: ['file:a.ts'] },
    });

    const list = await request(app)
      .get(`/api/v1/repos/${repoId}/views`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.views).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/workspace/views/${viewId}`)
      .set(bearer(token))
      .send({ isPinned: false, state: { focusNode: 'file:c.ts' } });
    expect(update.status).toBe(200);
    expect(update.body.data.view.isPinned).toBe(false);
    expect(update.body.data.view.state).toMatchObject({
      level: 'file',
      searchQuery: 'a',
      focusNode: 'file:c.ts',
      highlightedNodes: ['file:a.ts'],
    });

    const duplicate = await request(app)
      .post(`/api/v1/repos/${repoId}/views`)
      .set(bearer(token))
      .send({ name: 'Critical path', state: { level: 'file' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');

    const del = await request(app)
      .delete(`/api/v1/workspace/views/${viewId}`)
      .set(bearer(token));
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(`/api/v1/workspace/views/${viewId}`)
      .set(bearer(token));
    expect(gone.status).toBe(404);
  });

  it('validates the view payload and never exposes another user’s view', async () => {
    const owner = await setupWorkspace('views-owner@test.dev');
    const stranger = await registerUser({
      name: 'Stranger',
      email: 'views-stranger@test.dev',
      password: 'supersecret123',
    });

    const bad = await request(app)
      .post(`/api/v1/repos/${owner.repoId}/views`)
      .set(bearer(owner.token))
      .send({ name: '', state: { level: 'galaxy' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const create = await request(app)
      .post(`/api/v1/repos/${owner.repoId}/views`)
      .set(bearer(owner.token))
      .send({ name: 'Private', state: { level: 'file' } });
    const viewId = create.body.data.view.id as string;

    const foreignGet = await request(app)
      .get(`/api/v1/workspace/views/${viewId}`)
      .set(bearer(stranger.accessToken));
    expect(foreignGet.status).toBe(404);

    const foreignUpdate = await request(app)
      .patch(`/api/v1/workspace/views/${viewId}`)
      .set(bearer(stranger.accessToken))
      .send({ name: 'Hijacked' });
    expect(foreignUpdate.status).toBe(404);

    const foreignRepoViews = await request(app)
      .get(`/api/v1/repos/${owner.repoId}/views`)
      .set(bearer(stranger.accessToken));
    expect(foreignRepoViews.status).toBe(404);
  });
});

describe('pinned findings', () => {
  it('pins graph nodes, rejects unknown nodes, and enforces ownership', async () => {
    const { token, analysisId } = await setupWorkspace('pins@test.dev');
    const stranger = await registerUser({
      name: 'Pin Stranger',
      email: 'pins-stranger@test.dev',
      password: 'supersecret123',
    });

    const create = await request(app)
      .post(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token))
      .send({ nodeKey: 'file:a.ts', note: 'High-risk cycle member' });
    expect(create.status).toBe(201);
    const pinId = create.body.data.pin.id as string;
    expect(create.body.data.pin).toMatchObject({
      nodeKey: 'file:a.ts',
      note: 'High-risk cycle member',
    });

    const duplicate = await request(app)
      .post(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token))
      .send({ nodeKey: 'file:a.ts' });
    expect(duplicate.status).toBe(409);

    const missingNode = await request(app)
      .post(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token))
      .send({ nodeKey: 'file:does-not-exist.ts' });
    expect(missingNode.status).toBe(404);
    expect(missingNode.body.error.code).toBe('NODE_NOT_FOUND');

    const list = await request(app)
      .get(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.data.pins).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/workspace/pins/${pinId}`)
      .set(bearer(token))
      .send({ note: 'Reviewed' });
    expect(update.status).toBe(200);
    expect(update.body.data.pin.note).toBe('Reviewed');

    const foreignList = await request(app)
      .get(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(stranger.accessToken));
    expect(foreignList.status).toBe(404);

    const foreignDelete = await request(app)
      .delete(`/api/v1/workspace/pins/${pinId}`)
      .set(bearer(stranger.accessToken));
    expect(foreignDelete.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/workspace/pins/${pinId}`)
      .set(bearer(token));
    expect(del.status).toBe(200);

    const after = await request(app)
      .get(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token));
    expect(after.body.data.pins).toHaveLength(0);
  });
});

describe('report export', () => {
  it('returns a JSON report with health, cycles and pins', async () => {
    const { token, analysisId } = await setupWorkspace('report-json@test.dev');

    await request(app)
      .post(`/api/v1/analyses/${analysisId}/pins`)
      .set(bearer(token))
      .send({ nodeKey: 'file:a.ts', note: 'Pin for report' });

    const res = await request(app)
      .get(`/api/v1/analyses/${analysisId}/report`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { report } = res.body.data;
    expect(report.repo).toMatchObject({ owner: 'octocat', name: 'hello-world' });
    expect(report.health.repoScore).toBe(98);
    expect(report.cycles).toHaveLength(1);
    expect(report.pins).toEqual([
      { nodeKey: 'file:a.ts', note: 'Pin for report' },
    ]);
    expect(report.analysis.commitSha).toBe('deadbeefdeadbeef');
  });

  it('returns a Markdown attachment', async () => {
    const { token, analysisId } = await setupWorkspace('report-md@test.dev');

    const res = await request(app)
      .get(`/api/v1/analyses/${analysisId}/report`)
      .query({ format: 'markdown' })
      .set(bearer(token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('# RepoVerse report — octocat/hello-world');
    expect(res.text).toContain('## Circular dependencies');
    expect(res.text).toContain('Health score: 98/100');
  });

  it('rejects an unknown report format → 400 VALIDATION_ERROR', async () => {
    const { token, analysisId } = await setupWorkspace('report-bad@test.dev');

    const res = await request(app)
      .get(`/api/v1/analyses/${analysisId}/report`)
      .query({ format: 'pdf' })
      .set(bearer(token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
