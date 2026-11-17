import crypto from 'crypto';
import { env } from '../../config/env';
import { AppError } from '../../utils/appError';

/**
 * OAuth `state` parameter — CSRF protection for the Google callback
 * (blueprint security checklist: "OAuth state parameter validated").
 *
 * Stateless design (no express-session): the state is
 *   `${timestamp}.${nonce}.${hmac}`
 * where hmac = HMAC-SHA256 over `timestamp.nonce` with the JWT refresh
 * secret. The callback:
 *  1. requires the SAME value in a short-lived HttpOnly cookie,
 *  2. verifies the HMAC signature (an attacker cannot mint a state),
 *  3. rejects states older than 10 minutes.
 * Compare via crypto.timingSafeEqual (blueprint: timing-safe comparisons).
 */

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function createOAuthState(): string {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(`${timestamp}.${nonce}`)
    .digest('hex');
  return `${timestamp}.${nonce}.${sig}`;
}

export function verifyOAuthState(state: string | undefined, cookieState: string | undefined): void {
  const invalid = () =>
    new AppError(
      400,
      'OAUTH_STATE_INVALID',
      'OAuth state validation failed — restart the login flow'
    );

  if (
    typeof state !== 'string' ||
    typeof cookieState !== 'string' ||
    state.length !== cookieState.length
  ) {
    throw invalid();
  }
  if (!crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    throw invalid();
  }

  const [timestamp, nonce, sig] = state.split('.');
  if (!timestamp || !nonce || !sig) throw invalid();

  const expected = crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(`${timestamp}.${nonce}`)
    .digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw invalid();
  }

  const age = Date.now() - parseInt(timestamp, 36);
  if (Number.isNaN(age) || age < 0 || age > STATE_MAX_AGE_MS) {
    throw invalid();
  }
}
