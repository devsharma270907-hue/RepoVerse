import { env } from '../config/env';
import { logger } from '../utils/logger';
import { Analysis } from '../modules/analyses/analysis.model';
import { publishAnalysisUpdate } from '../socket';
import fs from 'fs';
import path from 'path';

/**
 * Stale-analysis recovery cron (PRD §10.4 reliability guardrails).
 *
 * A crashed/restarted server leaves analyses stuck in a non-terminal state
 * forever (their in-process queue died with the process). This sweep:
 *  1. marks analyses non-terminal AND created before the timeout window as
 *     failed (ANALYSIS_TIMEOUT) so the UI never shows a perpetual spinner,
 *  2. deletes orphaned clone workspaces older than 1 hour (belt-and-braces
 *     cleanup for workspaces whose `finally` never ran).
 */

const TERMINAL_STATUSES = ['done', 'failed'] as const;

export async function sweepStaleAnalyses(): Promise<number> {
  const cutoff = new Date(
    Date.now() - (env.ANALYSIS_TIMEOUT_SECONDS * 1000 + 30_000)
  );

  const stale = await Analysis.find({
    status: { $nin: [...TERMINAL_STATUSES] },
    createdAt: { $lt: cutoff },
  })
    .select('_id userId repoId')
    .lean();

  for (const doc of stale) {
    await Analysis.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'failed',
          progress: 100,
          error: {
            code: 'ANALYSIS_TIMEOUT',
            message: 'Analysis interrupted — server restarted or timed out',
          },
          finishedAt: new Date(),
        },
      }
    );
    publishAnalysisUpdate(doc.userId, {
      analysisId: String(doc._id),
      repoId: String(doc.repoId),
      status: 'failed',
      progress: 100,
      error: {
        code: 'ANALYSIS_TIMEOUT',
        message: 'Analysis interrupted — server restarted or timed out',
      },
    });
  }

  if (stale.length > 0) {
    logger.warn(`Stale-analysis sweep failed ${stale.length} interrupted analyses`);
  }
  return stale.length;
}

/** Deletes clone workspaces older than 1 hour (should never happen). */
export function sweepOrphanClones(): number {
  const tmpRoot = path.resolve(env.ANALYSIS_TMP_DIR);
  if (!fs.existsSync(tmpRoot)) return 0;

  const cutoff = Date.now() - 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(tmpRoot)) {
    const abs = path.join(tmpRoot, entry);
    try {
      if (fs.statSync(abs).mtimeMs < cutoff) {
        fs.rmSync(abs, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // unreadable entry — leave it for the next sweep
    }
  }
  if (removed > 0) {
    logger.warn(`Sweep removed ${removed} orphaned clone workspaces`);
  }
  return removed;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the recurring sweep. Call once from server bootstrap. */
export function startStaleSweepCron(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void sweepStaleAnalyses().catch((err) =>
      logger.error(
        'Stale-analysis sweep failed',
        err instanceof Error ? err : new Error(String(err))
      )
    );
    try {
      sweepOrphanClones();
    } catch (err) {
      logger.error(
        'Orphan-clone sweep failed',
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }, intervalMs);
  timer.unref();
  logger.info(`Stale-analysis sweep scheduled every ${intervalMs / 1000}s`);
}

export function stopStaleSweepCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
