import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Runs before test-file imports so env validation sees test values
    setupFiles: ['tests/setup-env.ts'],
    include: ['tests/**/*.test.ts'],
    // One file at a time — each spins up its own in-memory mongod
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
