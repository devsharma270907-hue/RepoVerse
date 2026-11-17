import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';

beforeAll(startTestDB);
afterAll(stopTestDB);

const user = { name: 'Ada Lovelace', email: 'ada@test.dev', password: 'supersecret123' };

describe('auth', () => {
  it('registers a new user → 201, accessToken, HttpOnly refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(user);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(user.email);
    expect(typeof res.body.data.accessToken).toBe('string');

    const cookie = res.headers['set-cookie'][0] as string;
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('rejects duplicate email → 409 CONFLICT', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(user);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid body → 400 with per-field errors', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'nope', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fields)).toContain('email');
  });

  it('rejects malformed JSON → 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"broken');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('login: wrong password → 401 generic message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('login: unknown email → 401 same generic message (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.dev', password: 'whatever123' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('full session flow: login → me → refresh → logout → refresh revoked', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send(user);
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;
    const cookie = login.headers['set-cookie'] as string[];

    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(user.email);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);
    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.data.accessToken).toBe('string');
    const newCookie = refresh.headers['set-cookie'] as string[];

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', newCookie);
    expect(logout.status).toBe(200);

    // Old refresh cookie was rotated + revoked — reuse must fail
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', newCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('rejects refresh without cookie → 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects /users/me without token → 401 UNAUTHORIZED', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects /users/me with garbage token → 401 TOKEN_INVALID', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
