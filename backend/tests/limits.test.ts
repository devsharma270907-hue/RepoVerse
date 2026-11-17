import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { startTestDB, stopTestDB } from './helpers/db';
import { Analysis } from '../src/modules/analyses/analysis.model';
import { startAnalysisForRepo } from '../src/modules/analyses/analyses.service';
import { env } from '../src/config/env';

/**
 * Per-user analysis queue cap (PRD §10.4). The full API path is covered in
 * repos.test.ts; this exercises the service rule directly so the cap can be
 * tested without waiting for real pipeline runs.
 */
beforeAll(startTestDB);
afterAll(stopTestDB);

describe('analysis queue limit', () => {
  it('rejects a new analysis once the per-user active cap is reached', async () => {
    const original = env.ANALYSIS_MAX_QUEUED_PER_USER;
    env.ANALYSIS_MAX_QUEUED_PER_USER = 1;
    try {
      const userId = new Types.ObjectId();
      await Analysis.create({
        userId,
        repoId: new Types.ObjectId(),
        status: 'queued',
        progress: 0,
      });

      const repo = {
        _id: new Types.ObjectId(),
        userId,
      } as never;

      await expect(startAnalysisForRepo(repo)).rejects.toMatchObject({
        statusCode: 429,
        code: 'ANALYSIS_LIMIT_EXCEEDED',
      });
    } finally {
      env.ANALYSIS_MAX_QUEUED_PER_USER = original;
    }
  });
});
