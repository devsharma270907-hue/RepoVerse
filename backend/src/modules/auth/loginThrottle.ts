import { AppError } from '../../utils/appError';
import { LoginAttempt } from './loginAttempt.model';

/**
 * Account lockout after repeated failures (blueprint security checklist).
 * - 5 failed logins inside a 15-minute window lock the identifier.
 * - Counters are per normalized email, including non-existent emails, so the
 *   behavior cannot be used for account enumeration.
 * - A successful login clears the counter immediately.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export async function assertNotLocked(email: string): Promise<void> {
  const attempt = await LoginAttempt.findOne({ email }).lean();
  if (!attempt) return;

  const remainingMs = attempt.expiresAt.getTime() - Date.now();
  if (attempt.count >= MAX_FAILED_ATTEMPTS && remainingMs > 0) {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
    throw new AppError(
      429,
      'ACCOUNT_LOCKED',
      `Too many failed login attempts — try again in ${minutes} minute${minutes === 1 ? '' : 's'}`
    );
  }
}

export async function recordFailedLogin(email: string): Promise<void> {
  const now = Date.now();
  const expiresAt = new Date(now + LOCKOUT_WINDOW_MS);

  // A stale window (TTL may not have fired yet) restarts at 1
  await LoginAttempt.findOneAndUpdate(
    { email },
    [
      {
        $set: {
          count: {
            $cond: [
              { $gt: ['$expiresAt', new Date(now)] },
              { $add: ['$count', 1] },
              1,
            ],
          },
          expiresAt,
          lastAttemptAt: new Date(now),
        },
      },
    ],
    { upsert: true, returnDocument: 'after', updatePipeline: true }
  );
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await LoginAttempt.deleteOne({ email });
}
