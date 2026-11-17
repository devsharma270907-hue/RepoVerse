import http from 'node:http';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import app from '../src/app';
import { initSocketServer, closeSocketServer } from '../src/socket';
import { startTestDB, stopTestDB } from './helpers/db';
import { bearer, registerUser, waitForAnalysis } from './helpers/http';

/**
 * Real-time progress (PRD §5 onboarding flow): a genuine socket.io client
 * connects over the wire, authenticates with a JWT access token, and must
 * receive `analysis:update` events for analyses of ITS OWN user only.
 */

// Pipeline must be offline-safe (CI) — same mock as repos.test.ts
vi.mock('../src/services/analyzer/fetcher', async () => {
  const { createFetcherMock } = await import('./helpers/fetcherMock');
  return createFetcherMock();
});

beforeAll(async () => {
  await startTestDB();
});

afterAll(async () => {
  await stopTestDB();
  await closeSocketServer();
});

describe('socket.io progress streaming', () => {
  let httpServer: http.Server;
  let port: number;

  beforeAll(async () => {
    httpServer = http.createServer(app);
    initSocketServer(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('rejects connections without a token', async () => {
    const err = await new Promise<Error>((resolve) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
      });
      socket.on('connect_error', (e) => {
        socket.close();
        resolve(e);
      });
    });
    expect(err.message).toBe('Authentication required');
  });

  it('rejects connections with an invalid token', async () => {
    const err = await new Promise<Error>((resolve) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        auth: { token: 'not-a-jwt' },
      });
      socket.on('connect_error', (e) => {
        socket.close();
        resolve(e);
      });
    });
    expect(err.message).toBe('Invalid token');
  });

  it('streams analysis:update events for the owning user', async () => {
    const { accessToken } = await registerUser({
      name: 'Sock',
      email: 'sock@t.dev',
      password: 'supersecret123',
    });

    const socket: ClientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: accessToken },
    });
    await new Promise<void>((resolve) => socket.on('connect', resolve));

    const updates: Array<{ analysisId: string; status: string; progress: number }> = [];
    socket.on('analysis:update', (payload: (typeof updates)[number]) => {
      updates.push(payload);
    });

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(accessToken))
      .send({ url: 'https://github.com/octocat/hello-world' });
    const analysisId = reg.body.data.analysis.id as string;

    const { status } = await waitForAnalysis(analysisId, accessToken);
    expect(status).toBe('done');

    // let the final socket frames land
    await new Promise((r) => setTimeout(r, 300));
    socket.close();

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u) => u.analysisId === analysisId)).toBe(true);

    const statuses = updates.map((u) => u.status);
    expect(statuses).toContain('done');
    // terminal event carries the summary
    const last = updates[updates.length - 1];
    expect(last.progress).toBe(100);
    expect(last.status).toBe('done');
    expect((last as { summary?: unknown }).summary).toBeTruthy();
  }, 20_000);

  it('never delivers another user’s events (user-scoped rooms)', async () => {
    const owner = await registerUser({ name: 'O', email: 'owner@t.dev', password: 'supersecret123' });
    const stranger = await registerUser({ name: 'S', email: 'stranger@t.dev', password: 'supersecret123' });

    const strangerSocket: ClientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      auth: { token: stranger.accessToken },
    });
    await new Promise<void>((resolve) => strangerSocket.on('connect', resolve));

    const received: unknown[] = [];
    strangerSocket.on('analysis:update', (payload: unknown) => received.push(payload));

    const reg = await request(app)
      .post('/api/v1/repos')
      .set(bearer(owner.accessToken))
      .send({ url: 'https://github.com/octocat/hello-world' });
    const analysisId = reg.body.data.analysis.id as string;
    const { status } = await waitForAnalysis(analysisId, owner.accessToken);
    expect(status).toBe('done');

    await new Promise((r) => setTimeout(r, 300));
    strangerSocket.close();

    expect(received).toHaveLength(0);
  }, 20_000);
});
