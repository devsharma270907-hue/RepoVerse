import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';

// ── AI client mock ───────────────────────────────────────────────────────
// No network ever happens: the SDK wrapper is replaced with a canned
// structured response. Call counts are asserted (caching must work).
const { callClaudeStructured } = vi.hoisted(() => ({
  callClaudeStructured: vi.fn(),
}));
vi.mock('../src/services/ai/client', () => ({
  isAiConfigured: () => true,
  callClaudeStructured,
}));

// ── Fetcher mock (shared with repos.test.ts) ─────────────────────────────
vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

import { AiUsage } from '../src/modules/ai/usage.model';
import { env } from '../src/config/env';

const cannedExplanation = {
  data: {
    summary: 'Formats an object with lowercased keys.',
    keyPoints: ['Single exported helper', 'No side effects'],
    potentialIssues: [],
  },
  model: 'claude-test-1',
  usage: { inputTokens: 100, outputTokens: 50 },
};

beforeAll(async () => {
  await startTestDB();
  callClaudeStructured.mockResolvedValue(cannedExplanation);
});

afterAll(async () => {
  await stopTestDB();
});

beforeEach(() => {
  callClaudeStructured.mockClear();
  callClaudeStructured.mockResolvedValue(cannedExplanation);
});

describe('AI code explanation (PRD §4.6)', () => {
  let token: string;
  let analysisId: string;

  beforeAll(async () => {
    const { accessToken } = await registerUser({
      name: 'AI',
      email: 'ai@t.dev',
      password: 'supersecret123',
    });
    token = accessToken;
    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(token))
      .send({ url: 'https://github.com/octocat/hello-world' });
    analysisId = reg.body.data.analysis.id as string;
    await waitForAnalysis(analysisId, token);

    const me = await request(app).get('/api/v1/users/me').set(bearer(token));
    usageUserIdHolder.userId = me.body.data.user.id as string;
  });

  it('validates the body → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s for a node key that is not in the graph', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(token))
      .send({ node: 'sym:ghost.ts#phantom' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NODE_NOT_FOUND');
  });

  it('explains a symbol node, grounded in fetched source', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(token))
      .send({ node: 'sym:c.ts#c' });
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.cached).toBe(false);
    expect(data.explanation).toEqual(cannedExplanation.data);
    expect(data.modelVersion).toBe('claude-test-1');
    // grounding: the exact file the symbol lives in
    expect(data.source.path).toBe('c.ts');
    expect(data.source.startLine).toBeGreaterThan(0);
    // graph context for the symbol is included
    expect(data.graphContext.callers).toContain('sym:index.ts#main');

    expect(callClaudeStructured).toHaveBeenCalledTimes(1);
    const prompt = callClaudeStructured.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('c.ts');
    expect(prompt).toContain('export function c()');
  });

  it('caches per (analysis, node) — second call hits the cache', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(token))
      .send({ node: 'sym:c.ts#c' });
    expect(res.status).toBe(200);
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.explanation).toEqual(cannedExplanation.data);
    expect(callClaudeStructured).not.toHaveBeenCalled();
  });

  it('records token usage for budget enforcement', async () => {
    const usage = await AiUsage.find({ analysisId }).lean();
    expect(usage.length).toBe(1); // search usage comes later
    expect(usage[0].inputTokens).toBe(100);
    expect(usage[0].outputTokens).toBe(50);
  });

  it('enforces the monthly token budget → 429 AI_BUDGET_EXCEEDED', async () => {
    await AiUsage.create({
      analysisId,
      userId: usageUserIdHolder.userId,
      kind: 'explain',
      modelVersion: 'claude-test-1',
      inputTokens: env.AI_MONTHLY_TOKEN_BUDGET_PER_USER,
      outputTokens: 0,
    });

    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(token))
      .send({ node: 'file:a.ts' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('AI_BUDGET_EXCEEDED');
  });
});

/** Holder populated in the explain describe's beforeAll. */
const usageUserIdHolder: { userId?: string } = {};

describe('AI smart search (PRD §4.7)', () => {
  let token: string;
  let analysisId: string;

  beforeAll(async () => {
    const { accessToken } = await registerUser({
      name: 'AI2',
      email: 'ai2@t.dev',
      password: 'supersecret123',
    });
    token = accessToken;
    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(token))
      .send({ url: 'https://github.com/octocat/hello-world' });
    analysisId = reg.body.data.analysis.id as string;
    await waitForAnalysis(analysisId, token);

    const me = await request(app).get('/api/v1/users/me').set(bearer(token));
    usageUserIdHolder.userId = me.body.data.user.id as string;
  });

  it('validates the query → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/search`)
      .set(bearer(token))
      .send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an empty result set for a non-matching query', async () => {
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/search`)
      .set(bearer(token))
      .send({ query: 'zzzznothingmatches' });
    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
    expect(res.body.data.count).toBe(0);
    expect(callClaudeStructured).not.toHaveBeenCalled();
  });

  it('ranks matching candidates with LLM synthesis', async () => {
    callClaudeStructured.mockResolvedValueOnce({
      data: {
        results: [
          // keyword candidates for "unused helper function": 'unused' (exact
          // name, 60) and 'helper' (contains, 35) — in that ranked order
          { nodeKey: 'sym:orphan.ts#unused', why: 'Function named "unused"' },
          { nodeKey: 'sym:util.ts#helper', why: 'Shared helper function' },
        ],
      },
      model: 'claude-test-1',
      usage: { inputTokens: 40, outputTokens: 30 },
    });

    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/search`)
      .set(bearer(token))
      .send({ query: 'unused helper function' });
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.synthesisUsed).toBe(true);
    expect(data.modelVersion).toBe('claude-test-1');
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toMatchObject({ nodeKey: 'sym:orphan.ts#unused' });
    expect(data.results[0].why).toContain('unused');
    expect(data.results[1]).toMatchObject({ nodeKey: 'sym:util.ts#helper' });
    expect(callClaudeStructured).toHaveBeenCalledTimes(1);
  });

  it('ignores hallucinated nodeKeys and falls back to keyword results', async () => {
    callClaudeStructured.mockResolvedValueOnce({
      data: { results: [{ nodeKey: 'file:not-in-graph.ts', why: 'nonsense' }] },
      model: 'claude-test-1',
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/search`)
      .set(bearer(token))
      .send({ query: 'unused' });
    expect(res.status).toBe(200);
    expect(res.body.data.synthesisUsed).toBe(false);
    expect(res.body.data.results.length).toBeGreaterThan(0);
    for (const r of res.body.data.results) {
      expect(r.nodeKey).toMatch(/^(file|sym):/);
    }
  });

  it('enforces ownership: stranger gets 404, never 403', async () => {
    const stranger = await registerUser({
      name: 'AI3',
      email: 'ai3@t.dev',
      password: 'supersecret123',
    });
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/explain`)
      .set(bearer(stranger.accessToken))
      .send({ node: 'file:a.ts' });
    expect(res.status).toBe(404);
  });
});
