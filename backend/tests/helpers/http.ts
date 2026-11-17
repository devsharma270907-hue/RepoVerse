import request from 'supertest';
import { expect } from 'vitest';
import app from '../../src/app';

export const registerUser = async (
  body: Record<string, unknown>
): Promise<{ accessToken: string; cookies: string[] }> => {
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  return {
    accessToken: res.body.data.accessToken,
    cookies: res.headers['set-cookie'] as string[],
  };
};

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Polls an analysis until it reaches a terminal state or times out. */
export async function waitForAnalysis(
  analysisId: string,
  token: string
): Promise<{ status: string; body: Record<string, unknown> }> {
  for (let i = 0; i < 60; i++) {
    const res = await request(app)
      .get(`/api/v1/analyses/${analysisId}`)
      .set(bearer(token));
    expect(res.status).toBe(200);
    const { status } = res.body.data.analysis;
    if (status === 'done' || status === 'failed') {
      return { status, body: res.body.data.analysis };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Analysis did not finish in time');
}
