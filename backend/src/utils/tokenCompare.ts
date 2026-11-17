import crypto from 'crypto';

/**
 * Timing-safe string comparison wrapper (blueprint Section 4).
 * Use for any secret comparison — never `===`.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
