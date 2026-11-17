/**
 * Test environment — must run BEFORE any src import so config/env.ts
 * validation passes with deterministic, non-secret test values.
 */
process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_DB = 'true';
process.env.MONGODB_URI ||= 'mongodb://localhost:27017/repoverse-test';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(64);
// Deterministic AES-256-GCM key (64 hex chars) — never a real secret
process.env.ENCRYPTION_KEY ||= 'c'.repeat(64);
// Tests make many rapid requests — disable self-throttling
process.env.RATE_LIMIT_GLOBAL_MAX = '100000';
process.env.RATE_LIMIT_AUTH_MAX = '100000';
process.env.RATE_LIMIT_ANALYSIS_MAX = '100000';
process.env.RATE_LIMIT_AI_MAX = '100000';
process.env.ANALYSIS_MAX_QUEUED_PER_USER = '100000';
// AI module: dummy key so AI endpoints take the configured path (the SDK
// client module itself is mocked per test file — no network ever happens)
process.env.ANTHROPIC_API_KEY ||= 'sk-ant-test-dummy-key-0123456789abcdef';
process.env.AI_MONTHLY_TOKEN_BUDGET_PER_USER ||= '100000';
// Embeddings are OFF by default so no test ever reaches a provider. The
// embeddings suite flips env at runtime and stubs fetch with local vectors.
process.env.EMBEDDINGS_PROVIDER ||= 'none';
// Monitoring is opt-in: tests must never initialize Sentry or hit its ingest
delete process.env.SENTRY_DSN;
// Google OAuth enabled for oauth tests (endpoints point at a local test
// double server started in tests/oauth.test.ts — never real network)
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.GOOGLE_TOKEN_URL ||= 'http://127.0.0.1:45833/token';
process.env.GOOGLE_USERINFO_URL ||= 'http://127.0.0.1:45833/userinfo';
