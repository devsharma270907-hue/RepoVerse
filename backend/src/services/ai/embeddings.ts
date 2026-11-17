import { z } from 'zod';
import { Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { ParsedFile } from '../analyzer/parser';
import { FileEmbedding } from '../../modules/graph/fileEmbedding.model';

/**
 * Embeddings for Smart Search (PRD §10.2).
 *
 * - Provider abstraction over plain `fetch` (no extra npm dependency):
 *   Voyage AI (code-tuned) or OpenAI. Anthropic has no embeddings API.
 * - Only compact DERIVED summaries are embedded (path, exports, imports,
 *   symbol names) — never source code.
 * - Best-effort: a provider outage never fails an analysis; retrieval then
 *   degrades to keyword ranking.
 * - Atlas `$vectorSearch` when an index exists, otherwise an in-process
 *   cosine fallback over the stored vectors (also the CI/offline path).
 */

export type EmbeddingInputType = 'document' | 'query';

export interface SemanticHit {
  path: string;
  score: number;
}

// ── Configuration ────────────────────────────────────────────────────────

export function isEmbeddingsConfigured(): boolean {
  return (
    env.EMBEDDINGS_PROVIDER !== 'none' && Boolean(env.EMBEDDINGS_API_KEY)
  );
}

export function embeddingModel(): string {
  if (env.EMBEDDINGS_MODEL) return env.EMBEDDINGS_MODEL;
  return env.EMBEDDINGS_PROVIDER === 'openai'
    ? 'text-embedding-3-small'
    : 'voyage-code-4';
}

export function embeddingDimensions(): number {
  return env.EMBEDDINGS_DIMENSIONS;
}

// ── Provider calls ───────────────────────────────────────────────────────

const embeddingRowSchema = z.object({
  embedding: z.array(z.number()),
  index: z.number().int().nonnegative().optional(),
});

const providerResponseSchema = z.object({
  data: z.array(embeddingRowSchema).min(1),
  model: z.string().optional(),
});

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Non-retryable provider answer (bad key, bad model, …). */
class EmbeddingRequestError extends Error {}

async function postJson(url: string, body: unknown): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.EMBEDDINGS_API_KEY}`,
          'User-Agent': 'RepoVerse-Analyzer',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      if (res.ok) return (await res.json()) as unknown;

      const detail = (await res.text().catch(() => '')).slice(0, 200);

      // 429 / 5xx are transient — retry with linear backoff
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        lastError = new Error(`Embedding provider responded ${res.status}`);
        await sleep(RETRY_BASE_MS * (attempt + 1));
        continue;
      }

      throw new EmbeddingRequestError(
        `Embedding provider error ${res.status}${detail ? `: ${detail}` : ''}`
      );
    } catch (err) {
      if (err instanceof EmbeddingRequestError) throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Embedding provider is unavailable');
}

async function embedBatch(
  texts: string[],
  inputType: EmbeddingInputType
): Promise<number[][]> {
  const model = embeddingModel();
  const dimensions = embeddingDimensions();

  const isOpenAi = env.EMBEDDINGS_PROVIDER === 'openai';
  const url = isOpenAi
    ? 'https://api.openai.com/v1/embeddings'
    : 'https://api.voyageai.com/v1/embeddings';

  const body = isOpenAi
    ? {
        model,
        input: texts,
        encoding_format: 'float',
        // Only the v3 family accepts a custom width
        ...(model.startsWith('text-embedding-3')
          ? { dimensions }
          : {}),
      }
    : {
        model,
        input: texts,
        input_type: inputType,
        output_dimension: dimensions,
      };

  const parsed = providerResponseSchema.safeParse(await postJson(url, body));
  if (!parsed.success) {
    throw new Error('Embedding provider returned an unexpected payload');
  }

  const rows = [...parsed.data.data].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );
  if (rows.length !== texts.length) {
    throw new Error(
      `Embedding provider returned ${rows.length} vectors for ${texts.length} inputs`
    );
  }

  return rows.map((row) => {
    if (row.embedding.length !== dimensions) {
      throw new Error(
        `Embedding has ${row.embedding.length} dimensions, expected ${dimensions} ` +
          '(check EMBEDDINGS_DIMENSIONS matches the model and Atlas index)'
      );
    }
    return row.embedding;
  });
}

/** Embeds texts in provider-sized batches, preserving input order. */
export async function embedTexts(
  texts: string[],
  inputType: EmbeddingInputType = 'document'
): Promise<number[][]> {
  if (!isEmbeddingsConfigured()) {
    throw new Error('Embeddings are not configured');
  }
  if (texts.length === 0) return [];

  const batchSize = env.EMBEDDINGS_BATCH_SIZE;
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    vectors.push(...(await embedBatch(batch, inputType)));
  }

  return vectors;
}

// ── File summaries ───────────────────────────────────────────────────────

const MAX_SUMMARY_CHARS = 4000;
const MAX_SYMBOLS = 40;

/** Compact, source-free summary used as the embedding document (PRD §10.2). */
export function buildFileEmbeddingText(file: ParsedFile): string {
  const exports = file.symbols
    .filter((sym) => sym.exported)
    .map((sym) => sym.name);
  const symbols = file.symbols
    .slice(0, MAX_SYMBOLS)
    .map((sym) => `${sym.name} (${sym.kind})`);

  return [
    `File: ${file.path}`,
    `Lines of code: ${file.loc}`,
    `Exports: ${exports.length > 0 ? exports.join(', ') : '(none)'}`,
    `Imports: ${file.imports.length > 0 ? file.imports.join(', ') : '(none)'}`,
    `Symbols: ${symbols.length > 0 ? symbols.join(', ') : '(none)'}`,
  ]
    .join('\n')
    .slice(0, MAX_SUMMARY_CHARS);
}

// ── Persistence (best-effort in the pipeline) ─────────────────────────────

export interface EmbedAnalysisFilesOptions {
  analysisId: string;
  repoId: unknown;
  userId: unknown;
  files: ParsedFile[];
  previousAnalysisId?: unknown;
}

/**
 * Embeds per-file summaries for one analysis and stores the vectors.
 * Unchanged files reuse the previous analysis' vector when the summary text
 * and model are identical (same diff-aware spirit as the parser). Returns
 * the number of files indexed.
 */
export async function embedAnalysisFiles(
  opts: EmbedAnalysisFilesOptions
): Promise<number> {
  const model = embeddingModel();
  const dimensions = embeddingDimensions();

  const files = opts.files.slice(0, env.EMBEDDINGS_MAX_FILES);
  if (files.length < opts.files.length) {
    logger.warn(
      `Embedding cap reached — indexing ${files.length} of ${opts.files.length} files ` +
        '(raise EMBEDDINGS_MAX_FILES to index more)'
    );
  }
  if (files.length === 0) return 0;

  const texts = files.map(buildFileEmbeddingText);

  // Reuse identical vectors from the previous analysis (no provider call)
  const reusable = new Map<string, number[]>();
  if (opts.previousAnalysisId) {
    const previous = await FileEmbedding.find({
      analysisId: opts.previousAnalysisId,
      embeddingModel: model,
      dimensions,
    })
      .select('path text embedding')
      .lean();
    for (const doc of previous) {
      reusable.set(`${doc.path}\u0000${doc.text}`, doc.embedding);
    }
  }

  const freshIndexes: number[] = [];
  const vectors: Array<number[] | undefined> = texts.map((text, i) => {
    const hit = reusable.get(`${files[i]!.path}\u0000${text}`);
    if (hit) return hit;
    freshIndexes.push(i);
    return undefined;
  });

  if (freshIndexes.length > 0) {
    const fresh = await embedTexts(
      freshIndexes.map((i) => texts[i]!),
      'document'
    );
    freshIndexes.forEach((fileIndex, j) => {
      vectors[fileIndex] = fresh[j]!;
    });
  }

  await FileEmbedding.insertMany(
    files.map((file, i) => ({
      analysisId: opts.analysisId,
      repoId: opts.repoId,
      userId: opts.userId,
      path: file.path,
      text: texts[i]!,
      embedding: vectors[i]!,
      embeddingModel: model,
      dimensions,
    })),
    { ordered: false }
  );

  return files.length;
}

/** Bounds vector storage to the analyses still kept by the pipeline. */
export async function pruneAnalysisEmbeddings(
  repoId: unknown,
  keepAnalysisIds: unknown[]
): Promise<void> {
  await FileEmbedding.deleteMany({
    repoId,
    analysisId: { $nin: keepAnalysisIds.filter((id) => id != null) },
  });
}

// ── Retrieval ────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/** Flips once when the deployment has no Atlas vector index. */
let atlasUnavailable = false;

async function atlasVectorSearch(
  analysisId: string,
  queryVector: number[],
  limit: number
): Promise<SemanticHit[] | null> {
  if (atlasUnavailable) return null;

  try {
    const docs = (await FileEmbedding.aggregate([
      {
        $vectorSearch: {
          index: env.VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(limit * 10, 50),
          limit,
          filter: { analysisId: new Types.ObjectId(analysisId) },
        },
      },
      {
        $project: {
          _id: 0,
          path: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])) as Array<{ path?: string; score?: number }>;

    return docs
      .filter((doc): doc is { path: string; score?: number } =>
        Boolean(doc.path)
      )
      .map((doc) => ({
        path: doc.path,
        score: Number(doc.score ?? 0),
      }));
  } catch (err) {
    atlasUnavailable = true;
    logger.warn(
      'Atlas $vectorSearch unavailable — using in-process cosine fallback',
      err instanceof Error ? err : new Error(String(err))
    );
    return null;
  }
}

async function cosineVectorSearch(
  analysisId: string,
  queryVector: number[],
  limit: number
): Promise<SemanticHit[]> {
  const docs = await FileEmbedding.find({ analysisId })
    .select('path embedding')
    .limit(env.REPO_MAX_FILES)
    .lean();

  return docs
    .map((doc) => ({
      path: doc.path,
      score: cosineSimilarity(queryVector, doc.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Semantic candidates for a query within ONE analysis. Never throws: a
 * provider failure degrades Smart Search to keyword ranking.
 */
export async function searchAnalysisEmbeddings(
  analysisId: string,
  query: string,
  limit = 12
): Promise<SemanticHit[]> {
  if (!isEmbeddingsConfigured()) return [];

  const indexed = await FileEmbedding.exists({ analysisId });
  if (!indexed) return [];

  let queryVector: number[];
  try {
    const [first] = await embedTexts([query], 'query');
    if (!first) return [];
    queryVector = first;
  } catch (err) {
    logger.warn(
      'Query embedding failed — Smart Search falls back to keyword ranking',
      err instanceof Error ? err : new Error(String(err))
    );
    return [];
  }

  const atlas = await atlasVectorSearch(analysisId, queryVector, limit);
  if (atlas) return atlas;

  return cosineVectorSearch(analysisId, queryVector, limit);
}
