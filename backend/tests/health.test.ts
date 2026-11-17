import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import app from '../src/app';
import { startTestDB, stopTestDB } from './helpers/db';

beforeAll(startTestDB);
afterAll(stopTestDB);

describe('health & readiness', () => {
  it('GET /health → 200 liveness', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /ready → 200 when DB is connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
  });
});
