import request from 'supertest';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser } from './helpers/http';
import { Analysis } from '../src/modules/analyses/analysis.model';
import {
  sweepStaleAnalyses,
  sweepOrphanClones,
} from '../src/jobs/staleAnalyses';
import { env } from '../src/config/env';

/**
 * Stale-analysis recovery cron (PRD §10.4): interrupted analyses must never
 * spin forever — the sweep fails anything non-terminal older than the
 * timeout window, and orphaned clone workspaces are reaped.
 */
beforeAll(async () => {
  await startTestDB();
});

afterAll(async () => {
  await stopTestDB();
});

describe('stale analysis sweep', () => {
  it('fails interrupted analyses and leaves terminal ones alone', async () => {
    const { accessToken } = await registerUser({
      name: 'Cron',
      email: 'cron@t.dev',
      password: 'supersecret123',
    });
    const me = await request(app).get('/api/v1/users/me').set(bearer(accessToken));
    const userId = me.body.data.user.id as string;

    // Build one stale (interrupted) + one fresh (running) + one terminal
    const staleCutoff = new Date(
      Date.now() - (env.ANALYSIS_TIMEOUT_SECONDS * 1000 + 60_000)
    );

    const stale = await Analysis.create({
      userId,
      repoId: new Types.ObjectId(),
      status: 'parsing',
      progress: 50,
      createdAt: staleCutoff,
      updatedAt: staleCutoff,
    });
    const fresh = await Analysis.create({
      userId,
      repoId: new Types.ObjectId(),
      status: 'fetching',
      progress: 20,
    });
    const terminal = await Analysis.create({
      userId,
      repoId: new Types.ObjectId(),
      status: 'done',
      progress: 100,
      createdAt: staleCutoff,
      updatedAt: staleCutoff,
    });

    const failed = await sweepStaleAnalyses();
    expect(failed).toBeGreaterThanOrEqual(1);

    const staleAfter = await Analysis.findById(stale._id);
    expect(staleAfter?.status).toBe('failed');
    expect(staleAfter?.error?.code).toBe('ANALYSIS_TIMEOUT');

    const freshAfter = await Analysis.findById(fresh._id);
    expect(freshAfter?.status).toBe('fetching'); // untouched

    const terminalAfter = await Analysis.findById(terminal._id);
    expect(terminalAfter?.status).toBe('done'); // untouched
  });

  it('reaps orphaned clone workspaces older than an hour', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpRoot = path.resolve(env.ANALYSIS_TMP_DIR);
    fs.mkdirSync(tmpRoot, { recursive: true });

    const orphan = path.join(tmpRoot, 'orphan-owner-repo-123');
    fs.mkdirSync(orphan, { recursive: true });
    // backdate past the 1h cutoff
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(orphan, old, old);

    const recent = path.join(tmpRoot, 'recent-owner-repo-456');
    fs.mkdirSync(recent, { recursive: true });

    sweepOrphanClones();

    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    fs.rmSync(recent, { recursive: true, force: true });
  });
});
