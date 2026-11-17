import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for environment configuration (blueprint Section 3).
 * The app crashes immediately on bad config — never run with invalid env.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGODB_URI: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // AES-256-GCM key for third-party tokens at rest (blueprint Section 6).
  // 32 random bytes as 64 hex chars: `openssl rand -hex 32`
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters'),

  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),

  // Dev/test only — in-memory MongoDB instead of a real server
  USE_MEMORY_DB: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── GitHub ingestion (repo analyzer — PRD §10) ────────────────────────
  // Optional: unauthenticated API is rate-limited to 60 req/hr
  GITHUB_TOKEN: z.string().optional(),
  REPO_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),
  REPO_MAX_FILES: z.coerce.number().int().positive().default(2000),
  REPO_MAX_FILE_SIZE_KB: z.coerce.number().int().positive().default(200),
  ANALYSIS_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
  ANALYSIS_TMP_DIR: z.string().default('./tmp/clones'),
  // Per-user ceiling on non-terminal analyses (queued + running). The
  // per-repo 1-active rule is separate — this protects the worker queue.
  ANALYSIS_MAX_QUEUED_PER_USER: z.coerce.number().int().positive().default(2),

  // ── AI provider (PRD §8) ──────────────────────────────────────────────
  // Optional: AI endpoints answer 503 AI_NOT_CONFIGURED when unset
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_DEFAULT: z.string().default('claude-sonnet-5'),
  AI_MONTHLY_TOKEN_BUDGET_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .default(200000),
  AI_EXPLAIN_MAX_SOURCE_CHARS: z.coerce.number().int().positive().default(16000),

  // ── Embeddings / Atlas Vector Search (PRD §10.2) ─────────────────────
  // Optional: Smart Search falls back to keyword ranking when `none`.
  // Anthropic has no embeddings API — Voyage (code-tuned) or OpenAI.
  EMBEDDINGS_PROVIDER: z.enum(['none', 'voyage', 'openai']).default('none'),
  EMBEDDINGS_API_KEY: z.string().optional(),
  // Defaults per provider when unset: voyage-code-4 / text-embedding-3-small
  EMBEDDINGS_MODEL: z.string().optional(),
  // Must match the Atlas vector index `numDimensions`
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  EMBEDDINGS_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(64),
  // Cost/time ceiling — files beyond this are not embedded
  EMBEDDINGS_MAX_FILES: z.coerce.number().int().positive().default(500),
  VECTOR_INDEX_NAME: z.string().default('file_summaries_v1'),

  // ── Google OAuth (PRD §6 — optional: strategy only when env vars exist) ─
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default('http://localhost:5000/api/v1/auth/google/callback'),
  // Advanced: override Google's endpoints (proxy / self-hosted OIDC / tests)
  GOOGLE_TOKEN_URL: z.string().url().optional(),
  GOOGLE_USERINFO_URL: z.string().url().optional(),

  // Rate limits (per minute unless noted) — raised in test env so suites
  // don't self-throttle
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  // Analysis creation/refresh is expensive (clone + parse) — hourly per user
  RATE_LIMIT_ANALYSIS_MAX: z.coerce.number().int().positive().default(30),
  // LLM calls cost real money — per-minute per user in addition to the
  // monthly token budget (middleware/aiBudget.ts)
  RATE_LIMIT_AI_MAX: z.coerce.number().int().positive().default(30),

  // ── Monitoring (optional — blueprint: Winston + Sentry in production) ──
  // Unset SENTRY_DSN disables Sentry entirely (local dev + tests stay silent)
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1); // Crash immediately — never run with bad config
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
