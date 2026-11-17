import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser } from './helpers/http';

beforeAll(startTestDB);
afterAll(stopTestDB);

const password = 'supersecret123';

describe('active sessions', () => {
  it('lists sessions, flags the current one, and revokes another session', async () => {
    const email = 'sessions@test.dev';
    const reg = await registerUser({ name: 'Session User', email, password });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'second-device/1.0')
      .send({ email, password });
    expect(login.status).toBe(200);
    const loginToken = login.body.data.accessToken as string;
    const loginCookie = login.headers['set-cookie'] as string[];

    const list = await request(app)
      .get('/api/v1/users/me/sessions')
      .set(bearer(loginToken));
    expect(list.status).toBe(200);
    expect(list.body.data.sessions).toHaveLength(2);

    const current = list.body.data.sessions.filter(
      (s: { current: boolean }) => s.current
    );
    expect(current).toHaveLength(1);
    expect(current[0].userAgent).toBe('second-device/1.0');

    const other = list.body.data.sessions.find(
      (s: { current: boolean }) => !s.current
    );
    expect(typeof other.id).toBe('string');

    // Revoking the other session kills only its refresh token
    const revoke = await request(app)
      .delete(`/api/v1/users/me/sessions/${other.id}`)
      .set(bearer(loginToken));
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);

    const after = await request(app)
      .get('/api/v1/users/me/sessions')
      .set(bearer(loginToken));
    expect(after.body.data.sessions).toHaveLength(1);

    // The surviving session still rotates normally
    const liveRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', loginCookie);
    expect(liveRefresh.status).toBe(200);

    // A revoked-but-signed refresh token is a breach signal: 401 + full revoke
    const staleRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', reg.cookies);
    expect(staleRefresh.status).toBe(401);
    expect(staleRefresh.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('revokes all sessions and clears the refresh cookie', async () => {
    const email = 'revoke-all@test.dev';
    const reg = await registerUser({ name: 'Revoke All', email, password });

    const res = await request(app)
      .delete('/api/v1/users/me/sessions')
      .set(bearer(reg.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe('all');
    expect((res.headers['set-cookie'][0] as string)).toContain('refresh_token=;');

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', reg.cookies);
    expect(refresh.status).toBe(401);
  });

  it('returns 404 when revoking an unknown session id', async () => {
    const email = 'revoke-missing@test.dev';
    const reg = await registerUser({ name: 'Missing', email, password });

    const res = await request(app)
      .delete('/api/v1/users/me/sessions/00000000-0000-4000-8000-000000000000')
      .set(bearer(reg.accessToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('login lockout', () => {
  it('locks an email after 5 failed attempts for 15 minutes', async () => {
    const email = 'lockout@test.dev';
    await registerUser({ name: 'Locked', email, password });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }

    const locked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    // Even the correct password is refused while the window is open
    const correct = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(correct.status).toBe(429);
    expect(correct.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('lockout also applies to unknown emails (no account enumeration)', async () => {
    const email = 'ghost-lock@test.dev';
    for (let attempt = 1; attempt <= 5; attempt++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'nope-nope-nope' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'nope-nope-nope' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('a successful login clears the failure counter', async () => {
    const email = 'clear-lock@test.dev';
    await registerUser({ name: 'Clear', email, password });

    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }

    const ok = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(ok.status).toBe(200);

    const afterClear = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(afterClear.status).toBe(401);
    expect(afterClear.body.error.code).toBe('UNAUTHORIZED');
  });
});
