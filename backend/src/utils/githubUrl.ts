/**
 * GitHub repo URL parsing — the ONLY accepted ingestion shape (PRD §12 SSRF guard).
 * Everything downstream (GitHub API calls) is built from the validated
 * owner/name parts; user input can never redirect the fetch to another host.
 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/; // GitHub username rules
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/; // repo names allow . _ -

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

  const parts = url.pathname.split('/').filter((p) => p.length > 0);
  const owner = parts[0];
  let name = parts[1];
  if (!owner || !name) return null;

  name = name.replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;

  return { owner, name };
}
