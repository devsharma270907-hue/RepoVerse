/**
 * GitHub repository URL parsing — mirrors the backend allowlist.
 *
 * Client-side validation exists purely for fast feedback; the server always
 * re-validates (frontend security checklist).
 */

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export interface ParsedGitHubUrl {
  owner: string;
  name: string;
}

export function parseGitHubUrl(raw: string): ParsedGitHubUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    return null;
  }

  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const owner = parts[0];
  let name = parts[1];
  if (!owner || !name) return null;

  name = name.replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;

  return { owner, name };
}

export function isValidGitHubUrl(raw: string): boolean {
  return parseGitHubUrl(raw) !== null;
}

export function githubUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`;
}
