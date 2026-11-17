/**
 * Shared state for the mocked analyzer fetcher.
 *
 * Integration tests that exercise diff-aware refresh need the fake clone to
 * look like a NEW commit (changed/added/deleted files). They register an
 * overlay that runs after the fixture is copied into the temp workspace.
 */
export type CloneOverlay = (dir: string) => void;

const DEFAULT_SHA = 'deadbeefdeadbeef';

let overlay: CloneOverlay | null = null;
let sha = DEFAULT_SHA;
// Recorded token arguments — proves the user's PAT reaches GitHub calls
let lastMetaToken: string | undefined;
let lastCloneToken: string | undefined;

export function setCloneOverlay(fn: CloneOverlay | null): void {
  overlay = fn;
}

export function applyCloneOverlay(dir: string): void {
  overlay?.(dir);
}

export function setCloneSha(next: string): void {
  sha = next;
}

export function currentCloneSha(): string {
  return sha;
}

export function recordMetaToken(token?: string): void {
  lastMetaToken = token;
}

export function recordCloneToken(token?: string): void {
  lastCloneToken = token;
}

export function lastFetcherTokens(): { meta?: string; clone?: string } {
  return { meta: lastMetaToken, clone: lastCloneToken };
}

export function resetCloneControl(): void {
  overlay = null;
  sha = DEFAULT_SHA;
  lastMetaToken = undefined;
  lastCloneToken = undefined;
}
