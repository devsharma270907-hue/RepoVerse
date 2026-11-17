import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';
import { env } from '../src/config/env';
import { FileEmbedding } from '../src/modules/graph/fileEmbedding.model';
import {
  buildFileEmbeddingText,
  cosineSimilarity,
} from '../src/services/ai/embeddings';
import type { ParsedFile } from '../src/services/analyzer/parser';

// Search synthesis is not under test here — keep the LLM out of the loop.
vi.mock('../src/services/ai/client', () => ({
  isAiConfigured: () => false,
  callClaudeStructured: vi.fn(),
}));

// Offline pipeline: fake GitHub metadata + clone of the committed fixture
vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

/**
 * Embeddings / Atlas Vector Search (PRD §10.2).
 *
 * The provider is exercised through a stubbed `fetch`, so CI never reaches
 * Voyage/OpenAI. `$vectorSearch` is unavailable on the in-memory MongoDB —
 * these tests therefore also prove the in-process cosine fallback.
 */

const DIMS = 8;
const MODEL = 'voyage-test';

interface CapturedCall {
  url: string;
  body: {
    model: string;
    input: string[];
    input_type?: 'document' | 'query';
    output_dimension?: number;
  };
}

const providerCalls: CapturedCall[] = [];
const fetchMock = vi.fn();

/** Deterministic concept vectors — enough to prove semantic ranking. */
function fakeVector(text: string, inputType: 'document' | 'query'): number[] {
  const lower = text.toLowerCase();
  const vector = new Array<number>(DIMS).fill(0.01);

  if (inputType === 'query' && /entry|application/.test(lower)) {
    vector[0] = 1;
  }
  if (lower.includes('file: index.ts')) vector[0] = 1;
  if (lower.includes('helper')) vector[1] = 1;
  if (lower.includes('unused')) vector[2] = 1;

  return vector;
}

beforeAll(async () => {
  await startTestDB();

  // Enable embeddings at runtime (tests default to provider `none`)
  env.EMBEDDINGS_PROVIDER = 'voyage';
  env.EMBEDDINGS_API_KEY = 'voyage-test-key';
  env.EMBEDDINGS_MODEL = MODEL;
  env.EMBEDDINGS_DIMENSIONS = DIMS;
  env.EMBEDDINGS_BATCH_SIZE = 2;

  fetchMock.mockImplementation(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as CapturedCall['body'];
      providerCalls.push({ url: String(url), body });

      if (!String(url).includes('api.voyageai.com')) {
        throw new Error(`Unexpected network call in embeddings test: ${url}`);
      }

      const data = body.input.map((text, index) => ({
        embedding: fakeVector(text, body.input_type ?? 'document'),
        index,
      }));
      return new Response(JSON.stringify({ data, model: MODEL }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  env.EMBEDDINGS_PROVIDER = 'none';
  env.EMBEDDINGS_API_KEY = undefined;
  env.EMBEDDINGS_MODEL = undefined;
  await stopTestDB();
});

afterEach(() => {
  fetchMock.mockClear();
});

describe('embedding helpers', () => {
  it('builds a source-free summary from derived metadata only', () => {
    const file: ParsedFile = {
      path: 'src/billing.ts',
      hash: 'deadbeef',
      loc: 42,
      imports: ['src/util.ts'],
      callNames: ['chargeCard'],
      symbols: [
        {
          key: 'sym:src/billing.ts#charge',
          name: 'charge',
          kind: 'function',
          line: 3,
          exported: true,
          callees: [],
        },
      ],
    };

    const text = buildFileEmbeddingText(file);
    expect(text).toContain('File: src/billing.ts');
    expect(text).toContain('Exports: charge');
    expect(text).toContain('Imports: src/util.ts');
    expect(text).toContain('charge (function)');
    // Never any source code
    expect(text).not.toContain('callNames');
    expect(text).not.toContain('deadbeef');
  });

  it('cosine similarity is 1 for equal vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0); // dimension guard
  });
});

describe('analysis pipeline embeds file summaries', () => {
  let token: string;
  let repoId: string;
  let analysisId: string;
  let summary: Record<string, unknown>;

  beforeAll(async () => {
    const auth = await registerUser({
      name: 'Emb',
      email: 'emb@t.dev',
      password: 'supersecret123',
    });
    token = auth.accessToken;

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(token))
      .send({ url: 'https://github.com/octocat/hello-world' });
    expect(reg.status).toBe(202);
    repoId = reg.body.data.repo.id as string;
    analysisId = reg.body.data.analysis.id as string;

    const done = await waitForAnalysis(analysisId, token);
    expect(done.status).toBe('done');
    summary = done.body.summary as Record<string, unknown>;
  });

  it('indexes every parsed file and reports the count in the summary', async () => {
    expect(summary.embeddedFiles).toBe(6);
    expect(await FileEmbedding.countDocuments({ analysisId })).toBe(6);
  });

  it('stores only derived summaries + vectors (no source code)', async () => {
    const docs = await FileEmbedding.find({ analysisId }).lean();
    const texts = docs.map((d) => d.text).join('\n');

    expect(texts).toContain('File: index.ts');
    expect(texts).toContain('Symbols: main (function)');
    // Fixture source bodies must never leak into embeddings
    expect(texts).not.toContain('return');
    expect(texts).not.toContain('import {');
    for (const doc of docs) {
      expect(doc.embedding).toHaveLength(DIMS);
      expect(doc.embeddingModel).toBe(MODEL);
      expect(doc.dimensions).toBe(DIMS);
    }
  });

  it('calls the provider in batches with document vs query input types', async () => {
    const documents = providerCalls.filter(
      (call) => call.body.input_type === 'document'
    );
    expect(documents.length).toBeGreaterThan(0);
    for (const call of documents) {
      expect(call.url).toContain('api.voyageai.com/v1/embeddings');
      expect(call.body.model).toBe(MODEL);
      expect(call.body.output_dimension).toBe(DIMS);
      expect(call.body.input.length).toBeLessThanOrEqual(2); // EMBEDDINGS_BATCH_SIZE
    }
    expect(
      documents.reduce((sum, call) => sum + call.body.input.length, 0)
    ).toBe(6);
  });

  it('ranks a semantic-only match through the cosine fallback', async () => {
    // No keyword in the fixture's paths/names matches these words
    const res = await request(app)
      .post(`/api/v1/ai/analyses/${analysisId}/search`)
      .set(bearer(token))
      .send({ query: 'entry point of the application' });

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.semanticUsed).toBe(true);
    expect(data.synthesisUsed).toBe(false); // LLM mocked as unavailable
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]).toMatchObject({ nodeKey: 'file:index.ts' });
    expect(data.results[0].why).toContain('semantically similar');

    // The query was embedded via the provider with input_type=query
    const queryCalls = providerCalls.filter(
      (call) => call.body.input_type === 'query'
    );
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]!.body.input).toEqual(['entry point of the application']);
  });

  it('reuses unchanged vectors on refresh — no extra provider calls', async () => {
    const documentCallsBefore = providerCalls.filter(
      (call) => call.body.input_type === 'document'
    ).length;

    const refresh = await request(app)
      .post(`/api/v1/repos/${repoId}/refresh`)
      .set(bearer(token));
    expect(refresh.status).toBe(202);

    const nextId = refresh.body.data.analysis.id as string;
    const done = await waitForAnalysis(nextId, token);
    expect(done.status).toBe('done');
    expect(done.body.summary.embeddedFiles).toBe(6);

    // Same commit, same summaries → every vector copied forward
    const documentCallsAfter = providerCalls.filter(
      (call) => call.body.input_type === 'document'
    ).length;
    expect(documentCallsAfter).toBe(documentCallsBefore);

    // Retention: current + predecessor vectors only
    expect(await FileEmbedding.countDocuments({ repoId })).toBe(12);
    analysisId = nextId;
  });

  it('skips embeddings (and stays healthy) when no provider is configured', async () => {
    env.EMBEDDINGS_PROVIDER = 'none';

    const refresh = await request(app)
      .post(`/api/v1/repos/${repoId}/refresh`)
      .set(bearer(token));
    expect(refresh.status).toBe(202);

    const thirdId = refresh.body.data.analysis.id as string;
    const done = await waitForAnalysis(thirdId, token);
    expect(done.status).toBe('done');
    expect(done.body.summary.embeddedFiles).toBeUndefined();
    expect(await FileEmbedding.countDocuments({ analysisId: thirdId })).toBe(0);

    // Previous analysis' vectors survive for the next diff-aware refresh
    expect(await FileEmbedding.countDocuments({ analysisId })).toBe(6);
  });
});
