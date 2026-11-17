import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError, notFound } from '../../utils/appError';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';
import { User, UserDocument, RefreshTokenEntry } from '../users/user.model';
import {
  assertNotLocked,
  clearLoginAttempts,
  recordFailedLogin,
} from './loginThrottle';

const REFRESH_TTL_DAYS = 7;
const MAX_ACTIVE_SESSIONS = 20;
const BCRYPT_COST = 10;

/**
 * Constant-time login equalizer: comparing against a dummy hash when the
 * user does not exist keeps response timing uniform (no email enumeration).
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('repoverse-timing-equalizer', BCRYPT_COST);

/**
 * bcrypt truncates secrets at 72 bytes. Our refresh JWTs share the same
 * header + `sub` prefix, so raw tokens for one user would all compare equal.
 * Digesting first (44 base64 chars) keeps the full token significant while
 * still storing only a bcrypt hash at rest.
 */
function refreshTokenDigest(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('base64');
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: UserDocument;
  tokens: AuthTokens;
}

export interface SessionContext {
  userAgent?: string;
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt?: Date;
  userAgent?: string;
  current: boolean;
}

function pruneExpired(user: UserDocument): void {
  const now = Date.now();
  // Keep `used` entries until expiry — they are needed to detect replay/reuse.
  user.refreshTokens = user.refreshTokens.filter(
    (t) => t.expiresAt.getTime() > now
  );
  if (user.refreshTokens.length > MAX_ACTIVE_SESSIONS) {
    user.refreshTokens.splice(0, user.refreshTokens.length - MAX_ACTIVE_SESSIONS);
  }
}

export async function issueTokens(
  user: UserDocument,
  context: (SessionContext & { sessionId?: string }) = {}
): Promise<AuthTokens> {
  const userId = String(user._id);
  const sessionId = context.sessionId ?? crypto.randomUUID();
  const accessToken = signAccessToken({ sub: userId, email: user.email, sid: sessionId });
  const refreshToken = signRefreshToken({ sub: userId, sessionId });

  // Refresh tokens stored HASHED — never the raw JWT (blueprint Section 6)
  const tokenHash = await bcrypt.hash(refreshTokenDigest(refreshToken), BCRYPT_COST);

  user.refreshTokens.push({
    tokenHash,
    sessionId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    used: false,
    createdAt: new Date(),
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  });
  pruneExpired(user);
  await user.save();

  return { accessToken, refreshToken };
}

export async function registerUser(
  input: {
    name: string;
    email: string;
    password: string;
  },
  context: SessionContext = {}
): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await User.create({ name: input.name, email, passwordHash });

  const tokens = await issueTokens(user, context);
  return { user, tokens };
}

export async function loginUser(
  input: {
    email: string;
    password: string;
  },
  context: SessionContext = {}
): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  // Lockout is checked BEFORE user lookup so unknown emails behave identically
  await assertNotLocked(email);

  const user = await User.findOne({ email });

  const genericFailure = () =>
    new AppError(401, 'UNAUTHORIZED', 'Invalid email or password');

  if (!user) {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH); // timing equalizer
    await recordFailedLogin(email);
    throw genericFailure();
  }
  if (!user.passwordHash) {
    // OAuth-only account — no local password set
    await recordFailedLogin(email);
    throw genericFailure();
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    await recordFailedLogin(email);
    throw genericFailure();
  }

  await clearLoginAttempts(email);
  const tokens = await issueTokens(user, context);
  return { user, tokens };
}

export async function rotateRefreshToken(
  rawToken: string,
  context: SessionContext = {}
): Promise<AuthTokens> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(rawToken);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token expired');
    }
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token invalid');
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token invalid');
  }

  const now = Date.now();
  let matched: RefreshTokenEntry | undefined;
  for (const entry of user.refreshTokens) {
    if (entry.expiresAt.getTime() <= now) continue;
    if (await bcrypt.compare(refreshTokenDigest(rawToken), entry.tokenHash)) {
      matched = entry;
      break;
    }
  }

  if (!matched) {
    // Unknown-but-validly-signed refresh token → revoke everything (breach signal)
    user.refreshTokens = [];
    await user.save();
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token invalid');
  }

  if (matched.used) {
    // Replayed rotated token → assume compromise, revoke all sessions
    user.refreshTokens = [];
    await user.save();
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token already used — all sessions revoked');
  }

  // Rotation: mark old token used, issue a fresh pair IN THE SAME SESSION
  matched.used = true;
  matched.lastUsedAt = new Date();
  const tokens = await issueTokens(user, {
    sessionId: matched.sessionId,
    userAgent: matched.userAgent,
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
  });
  return tokens;
}

export async function logoutRefreshToken(rawToken: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(rawToken);
    const user = await User.findById(payload.sub);
    if (!user) return;

    const now = Date.now();
    const toRemove: string[] = [];
    for (const entry of user.refreshTokens) {
      if (
        entry.expiresAt.getTime() > now &&
        (await bcrypt.compare(refreshTokenDigest(rawToken), entry.tokenHash))
      ) {
        toRemove.push(entry.tokenHash);
      }
    }
    if (toRemove.length > 0) {
      user.refreshTokens = user.refreshTokens.filter(
        (t) => !toRemove.includes(t.tokenHash)
      );
      await user.save();
    }
  } catch {
    // Invalid/expired token on logout — nothing to revoke, do not leak info
  }
}

// ── Session management (blueprint: view + revoke active sessions) ────────

export async function listSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionInfo[]> {
  const user = await User.findById(userId).select('refreshTokens').lean();
  if (!user) throw notFound('User not found');

  const now = Date.now();
  const bySession = new Map<string, SessionInfo>();

  for (const entry of user.refreshTokens) {
    // `used` entries are rotation leftovers, not live sessions
    if (entry.used || entry.expiresAt.getTime() <= now) continue;

    const existing = bySession.get(entry.sessionId);
    if (existing && existing.createdAt.getTime() >= entry.createdAt.getTime()) {
      continue;
    }
    bySession.set(entry.sessionId, {
      id: entry.sessionId,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
      ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      current: entry.sessionId === currentSessionId,
    });
  }

  return [...bySession.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export async function revokeSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');

  const before = user.refreshTokens.length;
  user.refreshTokens = user.refreshTokens.filter(
    (entry) => entry.sessionId !== sessionId
  );
  if (user.refreshTokens.length === before) {
    throw notFound('Session not found');
  }
  await user.save();
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } });
}
