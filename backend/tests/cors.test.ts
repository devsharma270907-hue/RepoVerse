import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from '../src/app';

const ORIGIN = 'http://localhost:5173';

/** Browser preflight for a given method/route. */
function preflight(path: string, method: string) {
  return request(app)
    .options(path)
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', 'content-type,authorization');
}

describe('CORS preflight', () => {
  it('echoes an allowed origin and never uses a wildcard with credentials', async () => {
    const res = await preflight('/api/v1/auth/login', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toContain('authorization');
  });

  it('permits every method the API actually routes, including PUT', async () => {
    const res = await preflight('/api/v1/users/me/github-token', 'PUT');

    expect(res.status).toBe(204);
    const allowed = (res.headers['access-control-allow-methods'] as string)
      .split(',')
      .map((m) => m.trim());

    // PUT is used by PUT /users/me/github-token; omitting it makes browsers
    // reject the request before it is ever sent (surface: "Network Error").
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(allowed).toContain(method);
    }
  });

  it('rejects an origin that is not on the allowlist', async () => {
    const res = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
