import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';
import { resetCloneControl, setCloneOverlay, setCloneSha } from './helpers/cloneControl';
import { FileSnapshot } from '../src/modules/graph/fileSnapshot.model';

// Offline-safe pipeline: fake GitHub metadata + clone of the committed fixture
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

afterEach(() => {
  resetCloneControl();
});

const REPO_URL = 'https://github.com/octocat/hello-world';
let userSeq = 0;

/**
 * Diff-aware refresh (PRD §4.8 / §10.4):
 *  - file snapshots persist derived metadata only (never source)
 *  - identical content → everything reused, nothing re-parsed
 *  - changed/added/deleted files are re-parsed incrementally
 *  - the incremental graph is IDENTICAL to a full parse of the same tree
 */
interface RegisteredRepo {
  token: string;
  repoId: string;
  analysisId: string;
  summary: Record<string, unknown>;
}

async function registerRepo(): Promise<RegisteredRepo> {
  const email = `inc${++userSeq}@t.dev`;
  const { accessToken } = await registerUser({
    name: `Inc ${userSeq}`,
    email,
    password: 'supersecret123',
  });
  const reg = await request(app)
    .post('/api/v1/repos')
    .set(bearer(accessToken))
    .send({ url: REPO_URL });
  expect(reg.status).toBe(202);

  const analysisId = reg.body.data.analysis.id as string;
  const { status, body } = await waitForAnalysis(analysisId, accessToken);
  expect(status).toBe('done');

  return {
    token: accessToken,
    repoId: reg.body.data.repo.id as string,
    analysisId,
    summary: body.summary as Record<string, unknown>,
  };
}

async function refresh(repo: RegisteredRepo): Promise<{ analysisId: string; summary: Record<string, unknown> }> {
  const res = await request(app)
    .post(`/api/v1/repos/${repo.repoId}/refresh`)
    .set(bearer(repo.token));
  expect(res.status).toBe(202);

  const analysisId = res.body.data.analysis.id as string;
  const { status, body } = await waitForAnalysis(analysisId, repo.token);
  expect(status).toBe('done');
  return { analysisId, summary: body.summary as Record<string, unknown> };
}

interface GraphPayload {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

async function graphOf(analysisId: string, token: string): Promise<GraphPayload> {
  const res = await request(app)
    .get(`/api/v1/graph/${analysisId}`)
    .query({ level: 'symbol' })
    .set(bearer(token));
  expect(res.status).toBe(200);
  const canon = (rows: Array<Record<string, unknown>>): string[] =>
    rows.map((r) => JSON.stringify(r)).sort();
  return {
    nodes: res.body.data.nodes as Array<Record<string, unknown>>,
    edges: res.body.data.edges as Array<Record<string, unknown>>,
  };
}

function canon(g: GraphPayload): { nodes: string[]; edges: string[] } {
  return {
    nodes: g.nodes.map((n) => JSON.stringify(n)).sort(),
    edges: g.edges.map((e) => JSON.stringify(e)).sort(),
  };
}

describe('diff-aware refresh (PRD §4.8)', () => {
  it('stores derived snapshots on the first analysis and reports no diff', async () => {
    const repo = await registerRepo();

    expect(repo.summary).not.toHaveProperty('diff');
    const snapshots = await FileSnapshot.find({ analysisId: repo.analysisId }).lean();
    expect(snapshots).toHaveLength(6);

    // Derived metadata only — no source text anywhere in the snapshot
    for (const snap of snapshots) {
      expect(snap.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.keys(snap).sort()).toEqual(
        expect.arrayContaining(['analysisId', 'callNames', 'hash', 'imports', 'loc', 'path', 'symbols'])
      );
      expect(JSON.stringify(snap)).not.toContain('return');
    }
  });

  it('reuses every file when content is unchanged and produces an identical graph', async () => {
    const repo = await registerRepo();
    const before = canon(await graphOf(repo.analysisId, repo.token));

    const next = await refresh(repo);
    expect(next.summary.diff).toEqual({
      reusedFiles: 6,
      changedFiles: 0,
      addedFiles: 0,
      deletedFiles: 0,
    });
    expect(next.summary).toMatchObject({ fileCount: 6, symbolCount: 6, cycleCount: 1, healthScore: 98 });

    expect(canon(await graphOf(next.analysisId, repo.token))).toEqual(before);

    // Snapshots pruned to the current analysis + predecessor only
    const all = await FileSnapshot.find({ repoId: repo.repoId }).lean();
    const analysisIds = new Set(all.map((s) => String(s.analysisId)));
    expect(analysisIds).toEqual(new Set([repo.analysisId, next.analysisId]));
    expect(all).toHaveLength(12);

    // …and a second refresh reuses the immediately preceding analysis
    const third = await refresh(repo);
    expect(third.summary.diff).toMatchObject({ reusedFiles: 6 });
    expect(canon(await graphOf(third.analysisId, repo.token))).toEqual(before);
  });

  it('re-parses only the changed file and matches a full parse of the same tree', async () => {
    const repo = await registerRepo();

    // Simulate a new commit: util.ts gains an exported arrow function
    setCloneOverlay((dir) => {
      fs.appendFileSync(path.join(dir, 'util.ts'), '\nexport const doubled = (n: number) => n * 2;\n');
    });
    setCloneSha('cafebabecafebabe');

    const incremental = await refresh(repo);
    expect(incremental.summary.diff).toEqual({
      reusedFiles: 5,
      changedFiles: 1,
      addedFiles: 0,
      deletedFiles: 0,
    });
    expect(incremental.summary.symbolCount).toBe(7);

    // Golden invariant: incremental result === first-time full parse
    const fresh = await registerRepo(); // same overlay → parses modified tree
    expect(fresh.summary).not.toHaveProperty('diff');
    expect(fresh.summary.symbolCount).toBe(7);
    expect(canon(await graphOf(incremental.analysisId, repo.token))).toEqual(
      canon(await graphOf(fresh.analysisId, fresh.token))
    );

    const nodes = (await graphOf(incremental.analysisId, repo.token)).nodes;
    expect(nodes.some((n) => n.id === 'sym:util.ts#doubled')).toBe(true);
  });

  it('reports added and deleted files and keeps the graph consistent', async () => {
    const repo = await registerRepo();

    setCloneOverlay((dir) => {
      fs.writeFileSync(
        path.join(dir, 'fresh.ts'),
        "import { helper } from './util';\n\nexport function fresh(): number {\n  return helper();\n}\n"
      );
      fs.rmSync(path.join(dir, 'orphan.ts'));
    });
    setCloneSha('feedfacefeedface');

    const next = await refresh(repo);
    expect(next.summary.diff).toEqual({
      reusedFiles: 5,
      changedFiles: 0,
      addedFiles: 1,
      deletedFiles: 1,
    });
    expect(next.summary).toMatchObject({ fileCount: 6, symbolCount: 6 });

    const { nodes, edges } = await graphOf(next.analysisId, repo.token);
    expect(nodes.some((n) => n.id === 'file:orphan.ts')).toBe(false);
    expect(nodes.some((n) => n.id === 'file:fresh.ts')).toBe(true);
    expect(nodes.some((n) => n.id === 'sym:fresh.ts#fresh')).toBe(true);

    // Cross-file call edge from the newly parsed file resolves correctly…
    expect(
      edges.some((e) => e.kind === 'calls' && e.from === 'sym:fresh.ts#fresh' && e.to === 'sym:util.ts#helper')
    ).toBe(true);
    // …and the import edge to the unchanged util.ts survives
    expect(
      edges.some((e) => e.kind === 'imports' && e.from === 'file:fresh.ts' && e.to === 'file:util.ts')
    ).toBe(true);

    // Golden invariant again: identical to a full parse of the same tree
    const fresh = await registerRepo();
    expect(canon(await graphOf(next.analysisId, repo.token))).toEqual(
      canon(await graphOf(fresh.analysisId, fresh.token))
    );
  });
});
