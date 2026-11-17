import { logger } from '../../utils/logger';

/**
 * In-process analysis job queue (PRD §10.4).
 * - Global concurrency cap: heavy clone/parse work never overwhelms the host.
 * - Per-user cap of 1: a user's analyses run one at a time (FIFO per user).
 * - Cancellation: account deletion drops queued jobs and signals in-flight
 *   pipelines to stop before they write anything else.
 * Swap for a real worker (BullMQ/Redis) if/when scale demands it — the
 * enqueue() contract stays the same.
 */

interface Job {
  userId: string;
  task: () => Promise<void>;
}

const pending: Job[] = [];
const activeUsers = new Set<string>();
const cancelledUsers = new Set<string>();
let running = 0;
const MAX_GLOBAL_CONCURRENCY = 2;
const MAX_CANCELLED_TRACKED = 10_000;

export function enqueueAnalysis(userId: string, task: () => Promise<void>): void {
  pending.push({ userId, task });
  // Defer so create() responses resolve before heavy work starts
  setImmediate(pump);
}

/**
 * Cancels every queued job for a user and marks the user as cancelled so any
 * in-flight pipeline aborts before persisting more derived data. Used by
 * account deletion, where all persisted records are being erased anyway.
 */
export function cancelUserJobs(userId: string): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]?.userId === userId) pending.splice(i, 1);
  }

  // Bound the set: a cancellation only matters while the user still exists
  if (cancelledUsers.size >= MAX_CANCELLED_TRACKED) cancelledUsers.clear();
  cancelledUsers.add(userId);
}

/** True once the user's account deletion started — pipelines should bail out. */
export function isUserCancelled(userId: unknown): boolean {
  return cancelledUsers.has(String(userId));
}

function pump(): void {
  while (running < MAX_GLOBAL_CONCURRENCY) {
    const idx = pending.findIndex((job) => !activeUsers.has(job.userId));
    if (idx === -1) return;

    const job = pending.splice(idx, 1)[0];
    if (!job) return;

    running++;
    activeUsers.add(job.userId);

    job
      .task()
      .catch((err: unknown) => {
        logger.error(
          'Analysis job crashed',
          err instanceof Error ? err : new Error(String(err))
        );
      })
      .finally(() => {
        running--;
        activeUsers.delete(job.userId);
        pump();
      });
  }
}

/** Test helper: clears all queue state (no-op in production flows). */
export function resetQueueForTests(): void {
  pending.length = 0;
  activeUsers.clear();
  cancelledUsers.clear();
  running = 0;
}
