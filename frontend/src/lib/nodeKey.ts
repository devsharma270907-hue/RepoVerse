/**
 * Node-key helpers.
 *
 * Graph keys look like `file:src/app.ts` or `sym:src/app.ts#main`.
 * `#` must be URL-encoded when a symbol key travels in a query string.
 */

export type NodeKeyKind = 'repo' | 'file' | 'symbol' | 'unknown';

export function kindOfKey(key: string): NodeKeyKind {
  if (key.startsWith('repo:')) return 'repo';
  if (key.startsWith('file:')) return 'file';
  if (key.startsWith('sym:')) return 'symbol';
  return 'unknown';
}

/** File path for a file or symbol key (`sym:a.ts#x` → `a.ts`). */
export function filePathOfKey(key: string): string | null {
  if (key.startsWith('file:')) return key.slice(5);
  if (key.startsWith('sym:')) {
    const rest = key.slice(4);
    const hash = rest.indexOf('#');
    return hash >= 0 ? rest.slice(0, hash) : rest;
  }
  return null;
}

/** Symbol name for a symbol key (`sym:a.ts#A.b` → `A.b`). */
export function symbolNameOfKey(key: string): string | null {
  if (!key.startsWith('sym:')) return null;
  const rest = key.slice(4);
  const hash = rest.indexOf('#');
  return hash >= 0 ? rest.slice(hash + 1) : null;
}

/** Builds the file key for a path. */
export function fileKey(path: string): string {
  return `file:${path.replace(/^\/+/, '')}`;
}

/** Builds a symbol key. */
export function symbolKey(path: string, name: string): string {
  return `sym:${path.replace(/^\/+/, '')}#${name}`;
}

/** Query-string-safe encoding for keys that contain `#`. */
export function encodeNodeKey(key: string): string {
  return key.replace(/#/g, '%23');
}

/** Display label for a node key. */
export function labelOfKey(key: string): string {
  return symbolNameOfKey(key) ?? filePathOfKey(key) ?? key;
}
