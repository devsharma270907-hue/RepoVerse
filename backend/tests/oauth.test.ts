import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { registerUser } from './helpers/http';
import { User } from '../src/modules/users/user.model';
import { env } from '../src/config/env';

/**
 * Google OAuth (PRD §6) — full round trip against a LOCAL test double of
 * Google's OIDC endpoints (offline-safe for CI; env.GOOGLE_TOKEN_URL /
 * GOOGLE_USERINFO_URL point here): consent redirect with CSRF state →
 * code exchange → our JWT session (refresh cookie + access token in the
 * redirect fragment).
 */

const DOUBLE_PORT = 45833;
// The current OIDC profile the double will serve (set per test)
let currentProfile: { sub: string; email: string; name: string } = {
  sub: 'unset',
  email: 'unset@t.dev',
  name: 'unset',
};

let doubleServer: http.Server;

beforeAll(async () => {
  await startTestDB();

  doubleServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // node-oauth appends ?access_token=... — match on the pathname only
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.end(JSON.stringify({
          access_token: `ga-${currentProfile.sub}`,
          token_type: 'Bearer',
          expires_in: 3599,
        }));
      });
      return;
    }
    if (pathname === '/userinfo') {
      res.end(JSON.stringify({
        sub: currentProfile.sub,
        email: currentProfile.email,
        email_verified: true,
        name: currentProfile.name,
      }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => doubleServer.listen(DOUBLE_PORT, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => doubleServer.close(() => resolve()));
  await stopTestDB();
});

function setGoogleProfile(profile: { sub: string; email: string; name: string }): void {
  currentProfile = profile;
}

function extractCookie(setCookies: string[] | undefined, name: string): string | undefined {
  return setCookies?.find((c) => c.startsWith(`${name}=`));
}

describe('google oauth (PRD §6)', () => {
  it('redirects to Google consent with CSRF state + cookie', async () => {
    const res = await request(app).get('/api/v1/auth/google');
    expect(res.status).toBe(302);

    const location = res.headers.location as string;
    expect(location).toContain('accounts.google.com');
    // redirect_uri is sent URL-encoded
    expect(location).toContain(encodeURIComponent(env.GOOGLE_CALLBACK_URL));
    expect(location).toContain(`client_id=${env.GOOGLE_CLIENT_ID}`);

    const state = new URL(location).searchParams.get('state');
    expect(state).toBeTruthy();
    // the state must also travel in an HttpOnly cookie
    const cookie = extractCookie(res.headers['set-cookie'] as string[], 'g_state');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain(state!);
  });

  it('completes the round trip: new user, our tokens, refresh works', async () => {
    setGoogleProfile({
      sub: 'google-sub-new-1',
      email: 'fresh.google@t.dev',
      name: 'Fresh Google',
    });

    const start = await request(app).get('/api/v1/auth/google');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const stateCookie = extractCookie(start.headers['set-cookie'] as string[], 'g_state')!;

    const cb = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'auth-code-1', state })
      .set('Cookie', stateCookie);
    expect(cb.status).toBe(302);

    const location = cb.headers.location as string;
    expect(location).toContain(env.CLIENT_URL);
    expect(location).toContain('/oauth/callback#accessToken=');
    expect(extractCookie(cb.headers['set-cookie'] as string[], 'refresh_token')).toBeTruthy();

    // user was created OAuth-only (no password) and the access token works
    const accessToken = location.split('#accessToken=')[1];
    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('fresh.google@t.dev');

    const created = await User.findOne({ email: 'fresh.google@t.dev' });
    expect(created?.googleId).toBe('google-sub-new-1');
    expect(created?.passwordHash).toBeUndefined();

    // refresh cookie is a real session — rotation works immediately
    const refreshCookie = extractCookie(
      cb.headers['set-cookie'] as string[],
      'refresh_token'
    )!;
    const rot = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie.split(';')[0]);
    expect(rot.status).toBe(200);
    expect(rot.body.data.accessToken).toBeTruthy();
  });

  it('links an existing email/password account to the Google identity', async () => {
    // pre-register a normal password user with the SAME email Google returns
    await registerUser({
      name: 'Link Me',
      email: 'link.google@t.dev',
      password: 'supersecret123',
    });

    setGoogleProfile({
      sub: 'google-sub-link-9',
      email: 'link.google@t.dev',
      name: 'Link Me',
    });

    const start = await request(app).get('/api/v1/auth/google');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const stateCookie = extractCookie(start.headers['set-cookie'] as string[], 'g_state')!;

    const cb = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'auth-code-2', state })
      .set('Cookie', stateCookie);
    expect(cb.status).toBe(302);

    const user = await User.findOne({ email: 'link.google@t.dev' });
    expect(user?.googleId).toBe('google-sub-link-9'); // linked, not duplicated
    expect(user?.passwordHash).toBeTruthy(); // password login keeps working
    const count = await User.countDocuments({ email: 'link.google@t.dev' });
    expect(count).toBe(1);
  });

  it('rejects a forged state (no cookie) → redirect with error, no user', async () => {
    setGoogleProfile({
      sub: 'google-sub-evil',
      email: 'evil@t.dev',
      name: 'Evil',
    });

    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'auth-code-3', state: 'forged.state.sig' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=state_mismatch');

    const count = await User.countDocuments({ email: 'evil@t.dev' });
    expect(count).toBe(0);
  });

  it('rejects a mismatched cookie state → redirect with error', async () => {
    setGoogleProfile({
      sub: 'google-sub-evil2',
      email: 'evil2@t.dev',
      name: 'Evil 2',
    });

    // a real state from one flow + cookie from ANOTHER flow
    const start = await request(app).get('/api/v1/auth/google');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;

    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'auth-code-4', state })
      .set('Cookie', 'g_state=some.other.forgedvalue');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=state_mismatch');

    const count = await User.countDocuments({ email: 'evil2@t.dev' });
    expect(count).toBe(0);
  });
});
