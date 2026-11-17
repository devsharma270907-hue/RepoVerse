/**
 * Access token storage — memory only, by design.
 *
 * Security checklist: no repo source, analysis content or credentials are
 * ever persisted to localStorage/sessionStorage. The refresh token lives in
 * an HttpOnly cookie the JavaScript cannot read, so a successful XSS cannot
 * exfiltrate either credential from storage.
 */

let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },

  set(token: string | null): void {
    accessToken = token;
    for (const listener of listeners) listener(accessToken);
  },

  clear(): void {
    tokenStore.set(null);
  },

  /** Subscribe to token changes. Returns an unsubscribe function. */
  subscribe(listener: (token: string | null) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Test-only helper to guarantee isolation between cases. */
export function __resetTokenStore(): void {
  accessToken = null;
  listeners.clear();
}
