import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Factory for the mocked analyzer fetcher used by integration tests:
 * the pipeline must be deterministic and offline-safe (CI) — metadata
 * checks never hit GitHub, and `cloneRepo` copies the committed fixture
 * project into a real temp dir so parser/graph code runs on actual files.
 *
 * Async so vi.mock factories can `await import(...)` it (ESM-safe).
 */
export async function createFetcherMock(): Promise<Record<string, unknown>> {
  const { AppError } = await import('../../src/utils/appError');
  const {
    applyCloneOverlay,
    currentCloneSha,
    recordCloneToken,
    recordMetaToken,
  } = await import('./cloneControl');
  const fixtureDir = fileURLToPath(
    new URL('../fixtures/sample-project', import.meta.url)
  );

  return {
    fetchRepoMeta: async (owner: string, name: string, token?: string) => {
      recordMetaToken(token);
      // Simulates GitHub: private repos require an authenticated token
      const isPrivate = name.startsWith('private');
      if (isPrivate && !token) {
        throw new AppError(
          422,
          'REPO_NOT_ACCESSIBLE',
          'Repository not found, or private without a GitHub token with access'
        );
      }
      if (owner.startsWith('missing')) {
        throw new AppError(
          422,
          'REPO_NOT_ACCESSIBLE',
          'Repository not found or not public'
        );
      }
      return {
        owner,
        name,
        fullName: `${owner}/${name}`,
        defaultBranch: 'main',
        sizeKb: 512,
        isPrivate,
      };
    },
    cloneRepo: async (
      _owner: string,
      _name: string,
      _branch: string,
      token?: string
    ) => {
      recordCloneToken(token);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repoverse-test-'));
      fs.cpSync(fixtureDir, dir, { recursive: true });
      // Tests may simulate a new commit by mutating the fake workspace
      applyCloneOverlay(dir);
      return { dir, commitSha: currentCloneSha() };
    },
    // fetchFileContent serves the fixture file from disk instead of GitHub raw
    fetchFileContent: async (
      _owner: string,
      _name: string,
      _ref: string,
      filePath: string
    ) => {
      const posix = filePath.replace(/\\/g, '/');
      if (posix.includes('..') || posix.startsWith('/')) {
        throw new AppError(400, 'INVALID_REQUEST', 'Invalid file path');
      }
      const abs = path.join(fixtureDir, posix);
      if (!fs.existsSync(abs)) {
        throw new AppError(
          404,
          'NODE_SOURCE_MISSING',
          'Source file no longer exists in the analyzed commit'
        );
      }
      return fs.readFileSync(abs, 'utf8');
    },
  };
}
