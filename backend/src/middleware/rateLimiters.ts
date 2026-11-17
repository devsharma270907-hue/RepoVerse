import { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Per-user rate limits for expensive endpoints (PRD §9 / §12).
 *
 * These are mounted AFTER requireAuth, so `req.user.id` is always present.
 * Keys fall back to IP for any unauthenticated mount to stay safe.
 *
 * Note: the limits are env-tunable so tests can raise/disable them
 * (tests/setup-env.ts) without changing assertion behavior.
 */

function userKey(req: Request): string {
  if (req.user?.id) {
    return req.user.id;
  }
  return ipKeyGenerator(req.ip ?? '127.0.0.1');
}

function limitHandler(code: string, message: string) {
  return (_req: Request, res: Response): void => {
    res.status(429).json({
      success: false,
      error: { code, message },
    });
  };
}

/** Analysis creation/refresh: expensive clone + parse work, hourly window. */
export const analysisRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.RATE_LIMIT_ANALYSIS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: limitHandler(
    'RATE_LIMIT_EXCEEDED',
    'Too many analysis requests — please wait before starting another one'
  ),
});

/** AI calls: per-minute guard in addition to the monthly token budget. */
export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: env.RATE_LIMIT_AI_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  handler: limitHandler(
    'RATE_LIMIT_EXCEEDED',
    'Too many AI requests — please slow down'
  ),
});
