import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';

// ── Fetcher mock ─────────────────────────────────────────────────────────
// The pipeline must be deterministic and offline-safe (CI): metadata checks
// never hit GitHub, and `cloneRepo` copies the committed fixture project
// into a real temp dir so parser/graph code runs against actual files.
vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

beforeAll(async () => {
  await startTestDB();
});

afterAll(async () => {
  await stopTestDB();
});

const OWNER = 'octocat';
const NAME = 'hello-world';

// ── Tests ────────────────────────────────────────────────────────────────

describe('repos & analysis pipeline', () => {
  it('rejects a non-github URL → 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerUser({ name: 'A', email: 'a@t.dev', password: 'supersecret123' });
    const res = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url: 'http://evil.example.com/some/repo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an inaccessible repo → 422 REPO_NOT_ACCESSIBLE', async () => {
    const { accessToken } = await registerUser({ name: 'B', email: 'b@t.dev', password: 'supersecret123' });
    const res = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url: 'https://github.com/missing-user-xyz/repo-nope-123' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REPO_NOT_ACCESSIBLE');
  });

  it('registers a repo, runs the pipeline, returns symbol-level stats', async () => {
    const { accessToken } = await registerUser({ name: 'C', email: 'c@t.dev', password: 'supersecret123' });

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url: `https://github.com/${OWNER}/${NAME}` });

    expect(reg.status).toBe(202);
    expect(reg.body.data.analysis.status).toBe('queued');
    const analysisId = reg.body.data.analysis.id as string;
    const repoId = reg.body.data.repo.id as string;

    // Top-level aliases let clients poll without digging into nested objects
    expect(reg.body.data.repoId).toBe(repoId);
    expect(reg.body.data.analysisId).toBe(analysisId);
    expect(reg.body.data.status).toBe('queued');
    expect(reg.body.data.progress).toBe(0);

    const { status, body } = await waitForAnalysis(analysisId, accessToken);
    expect(status).toBe('done');
    // Fixture: 6 source files, 6 symbols, one a.ts⇄b.ts import cycle
    expect(body.summary).toMatchObject({
      fileCount: 6,
      symbolCount: 6,
      cycleCount: 1,
      healthScore: 98,
      skippedLarge: 0,
      truncated: false,
      languages: [{ ext: 'ts', count: 6 }],
    });
    expect(body.commitSha).toBe('deadbeefdeadbeef');

    // Repo shows up in the paginated list
    const list = await request(app).get('/api/v1/repos').set(bearer(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.data[0].id).toBe(repoId);
  });

  it('re-adding the same repo returns it (no 409) and re-queues analysis', async () => {
    const { accessToken } = await registerUser({ name: 'D', email: 'd@t.dev', password: 'supersecret123' });
    const url = { url: `https://github.com/${OWNER}/${NAME}` };

    const first = await request(app).post('/api/v1/repos').set(bearer(accessToken)).send(url);
    expect(first.status).toBe(202);
    expect(first.body.data.created).toBe(true);
    await waitForAnalysis(first.body.data.analysis.id, accessToken);

    const second = await request(app).post('/api/v1/repos').set(bearer(accessToken)).send(url);
    expect(second.status).toBe(202);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.repo.id).toBe(first.body.data.repo.id);
  });

  it('enforces ownership: another user gets 404, never 403', async () => {
    const owner = await registerUser({ name: 'E', email: 'e@t.dev', password: 'supersecret123' });
    const stranger = await registerUser({ name: 'F', email: 'f@t.dev', password: 'supersecret123' });

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(owner.accessToken))
      .send({ url: `https://github.com/${OWNER}/${NAME}` });
    const repoId = reg.body.data.repo.id as string;
    const analysisId = reg.body.data.analysis.id as string;

    const get = await request(app).get(`/api/v1/repos/${repoId}`).set(bearer(stranger.accessToken));
    expect(get.status).toBe(404);

    const analysis = await request(app)
      .get(`/api/v1/analyses/${analysisId}`)
      .set(bearer(stranger.accessToken));
    expect(analysis.status).toBe(404);
    expect(analysis.body.error.code).toBe('NOT_FOUND');
  });

  it('soft-deletes a repo → later GET is 404', async () => {
    const { accessToken } = await registerUser({ name: 'G', email: 'g@t.dev', password: 'supersecret123' });
    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url: `https://github.com/${OWNER}/${NAME}` });
    const repoId = reg.body.data.repo.id as string;

    const del = await request(app).delete(`/api/v1/repos/${repoId}`).set(bearer(accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const get = await request(app).get(`/api/v1/repos/${repoId}`).set(bearer(accessToken));
    expect(get.status).toBe(404);
  });

  it('rejects malformed analysis ids → 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerUser({ name: 'H', email: 'h@t.dev', password: 'supersecret123' });
    const res = await request(app).get('/api/v1/analyses/not-an-objectid').set(bearer(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('graph & insights (Phase 2)', () => {
  let token: string;
  let analysisId: string;

  beforeAll(async () => {
    const { accessToken } = await registerUser({ name: 'I', email: 'i@t.dev', password: 'supersecret123' });
    token = accessToken;
    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(token))
      .send({ url: `https://github.com/${OWNER}/${NAME}` });
    analysisId = reg.body.data.analysis.id as string;
    await waitForAnalysis(analysisId, token);
  });

  it('returns file-level graph: import edges only, no symbol nodes', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { nodes, edges, level } = res.body.data;
    expect(level).toBe('file');
    expect(nodes).toHaveLength(6); // 6 files, 0 symbols
    for (const node of nodes) expect(node.id).toMatch(/^file:/);

    const importEdges = edges.filter((e: { kind: string }) => e.kind === 'imports');
    expect(edges).toHaveLength(5);
    expect(importEdges).toHaveLength(5);
    expect(edges.find((e: { from: string; to: string }) => e.from === 'file:a.ts' && e.to === 'file:b.ts')).toBeTruthy();
  });

  it('returns symbol-level graph including calls edges', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}?level=symbol`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { nodes, edges, level } = res.body.data;
    expect(level).toBe('symbol');
    expect(nodes).toHaveLength(12); // 6 files + 6 symbols

    // c.ts#c() calls a.ts#a()
    const callEdge = edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === 'calls' && e.from === 'sym:c.ts#c' && e.to === 'sym:a.ts#a'
    );
    expect(callEdge).toBeTruthy();
  });

  it('returns a nested file tree with symbol counts', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}/tree`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { fileCount, root } = res.body.data;
    expect(fileCount).toBe(6);
    expect(root.type).toBe('dir');
    // Flat fixture → all six files are direct children
    const files = (root.children as Array<{ type: string; path: string; symbolCount: number }>)
      .filter((c) => c.type === 'file');
    expect(files).toHaveLength(6);
    expect(files.map((f) => f.path).sort()).toEqual([
      'a.ts', 'b.ts', 'c.ts', 'index.ts', 'orphan.ts', 'util.ts',
    ]);
    expect(files.find((f) => f.path === 'index.ts')!.symbolCount).toBe(1);
  });

  it('returns a node with incoming/outgoing neighbours', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}/node`)
      .query({ node: 'sym:a.ts#a' })
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { node, incoming, outgoing } = res.body.data;
    expect(node.id).toBe('sym:a.ts#a');
    expect(node.kind).toBe('function');

    expect(incoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'sym:c.ts#c', edgeKind: 'calls' }),
      ])
    );
    expect(outgoing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'sym:b.ts#b', edgeKind: 'calls' }),
      ])
    );
  });

  it('404s for an unknown graph node', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}/node`)
      .query({ node: 'sym:nope.ts#missing' })
      .set(bearer(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NODE_NOT_FOUND');
  });

  it('traverses callers up to the requested depth', async () => {
    const res = await request(app)
      .get(`/api/v1/graph/${analysisId}/callers`)
      .query({ node: 'sym:a.ts#a', depth: 3 })
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { callers, count } = res.body.data;
    expect(count).toBe(2); // c() at depth 1, main() at depth 2
    expect(callers.find((c: { key: string }) => c.key === 'sym:c.ts#c')).toMatchObject({ depth: 1 });
    expect(callers.find((c: { key: string }) => c.key === 'sym:index.ts#main')).toMatchObject({ depth: 2 });
  });

  it('reports the a.ts ⇄ b.ts circular dependency', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/cycles`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { cycles, count } = res.body.data;
    expect(count).toBe(1);
    expect(cycles[0].length).toBe(2);
    expect(cycles[0].severity).toBe('low');
    expect(cycles[0].path).toEqual(expect.arrayContaining(['a.ts', 'b.ts']));
  });

  it('returns explainable health scores with DEAD_CODE on orphan.ts', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/health`)
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { repoScore, files } = res.body.data;
    expect(repoScore).toBe(98);

    const orphan = files.find((f: { path: string }) => f.path === 'orphan.ts');
    expect(orphan.score).toBe(85);
    expect(orphan.penalties.map((p: { code: string }) => p.code)).toEqual(['DEAD_CODE']);

    const index = files.find((f: { path: string }) => f.path === 'index.ts');
    expect(index.score).toBe(100);
    expect(index.metrics.deadCodeCandidate).toBe(false);
  });

  it('computes transitive impact of changing a.ts', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/impact`)
      .query({ node: 'a.ts' })
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { affected, count } = res.body.data;
    expect(count).toBe(3); // b.ts, c.ts (direct) + index.ts (depth 2)

    const b = affected.find((f: { path: string }) => f.path === 'b.ts');
    expect(b).toMatchObject({ depth: 1, direct: true, risk: 'high' });
    const index = affected.find((f: { path: string }) => f.path === 'index.ts');
    expect(index).toMatchObject({ depth: 2, direct: false });
  });

  it('exposes direct fan-in/fan-out and the deepest critical path', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/impact`)
      .query({ node: 'file:a.ts' })
      .set(bearer(token));
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.direction).toBe('dependents');
    expect(data.node).toBe('a.ts');
    expect(data.nodeKey).toBe('file:a.ts');
    expect(data.fanIn).toBe(2); // b.ts + c.ts import a.ts
    expect(data.fanOut).toBe(1); // a.ts imports b.ts
    expect(data.criticalDepth).toBe(2);
    expect(data.criticalPath[0]).toMatchObject({ path: 'a.ts', depth: 0 });
    expect(data.criticalPath).toHaveLength(3);
  });

  it('supports direction=dependencies (forward traversal)', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/impact`)
      .query({ node: 'a.ts', direction: 'dependencies' })
      .set(bearer(token));
    expect(res.status).toBe(200);

    const { direction, affected, count } = res.body.data;
    expect(direction).toBe('dependencies');
    expect(count).toBe(2); // b.ts (direct) then util.ts (via b.ts)
    expect(affected.find((f: { path: string }) => f.path === 'b.ts')).toMatchObject({
      depth: 1,
      direct: true,
    });
    expect(affected.find((f: { path: string }) => f.path === 'util.ts')).toMatchObject({
      depth: 2,
    });
  });

  it('returns an empty impact list for a node nothing depends on', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/impact`)
      .query({ node: 'index.ts' })
      .set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(0);
    expect(res.body.data.affected).toEqual([]);
  });

  it('rejects a missing impact node query → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get(`/api/v1/insights/${analysisId}/impact`)
      .set(bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces ownership on graph & insights: stranger gets 404', async () => {
    const stranger = await registerUser({ name: 'J', email: 'j@t.dev', password: 'supersecret123' });

    const graph = await request(app).get(`/api/v1/graph/${analysisId}`).set(bearer(stranger.accessToken));
    expect(graph.status).toBe(404);

    const cycles = await request(app).get(`/api/v1/insights/${analysisId}/cycles`).set(bearer(stranger.accessToken));
    expect(cycles.status).toBe(404);
  });
});
