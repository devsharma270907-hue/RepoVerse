import { AppError } from '../../utils/appError';
import { logger } from '../../utils/logger';
import { decrypt, encrypt } from '../../utils/encryption';
import { verifyGithubToken } from '../../services/github/tokenValidator';
import { GithubTokenEntry, User } from './user.model';

/**
 * Per-user GitHub PAT for private repositories (PRD §10.5 / §12).
 * The raw token is encrypted with AES-256-GCM, stored with `select: false`
 * and NEVER returned to clients — only a `••••1234` hint and metadata.
 */

export interface GithubTokenStatus {
  connected: boolean;
  hint?: string;
  scopes?: string[];
  updatedAt?: Date;
}

export function describeGithubToken(
  stored: Pick<GithubTokenEntry, 'hint' | 'scopes' | 'updatedAt'> | undefined | null
): GithubTokenStatus {
  if (!stored) return { connected: false };
  return {
    connected: true,
    hint: stored.hint,
    scopes: stored.scopes ?? [],
    updatedAt: stored.updatedAt,
  };
}

/** Verifies with GitHub, then stores the encrypted token. */
export async function setGithubToken(
  userId: string,
  token: string
): Promise<GithubTokenStatus> {
  // Verify BEFORE persisting — a bad token never reaches the database
  const identity = await verifyGithubToken(token);

  const payload = encrypt(token);
  const updatedAt = new Date();
  const hint = `••••${token.slice(-4)}`;

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { githubToken: { ...payload, hint, scopes: identity.scopes, updatedAt } } },
    { returnDocument: 'after', projection: { githubToken: 1 } }
  ).lean();

  if (!updated) throw new AppError(404, 'NOT_FOUND', 'User not found');

  return { connected: true, hint, scopes: identity.scopes, updatedAt };
}

export async function removeGithubToken(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $unset: { githubToken: 1 } });
}

/**
 * Decrypts the user's stored PAT for GitHub calls (metadata, clone, raw file).
 * Returns undefined when the user has not connected one — public flows then
 * run unauthenticated (or with the server-wide GITHUB_TOKEN fallback).
 */
export async function resolveUserGithubToken(
  userId: string
): Promise<string | undefined> {
  const user = await User.findById(userId).select('+githubToken').lean();
  const stored = user?.githubToken;
  if (!stored) return undefined;

  try {
    return decrypt(stored);
  } catch (err) {
    // Key rotation or tampering — never fall back silently to a broken token
    logger.warn(
      'Stored GitHub token cannot be decrypted — user must reconnect',
      err instanceof Error ? err : new Error(String(err))
    );
    throw new AppError(
      503,
      'GITHUB_TOKEN_UNREADABLE',
      'Stored GitHub token cannot be decrypted — please reconnect it'
    );
  }
}
