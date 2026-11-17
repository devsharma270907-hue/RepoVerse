import { describe, it, expect } from 'vitest';
import type { Event } from '@sentry/node';
import {
  captureException,
  initSentry,
  isSentryEnabled,
  scrubSentryEvent,
} from '../src/config/sentry';

describe('optional Sentry monitoring', () => {
  it('stays disabled when SENTRY_DSN is unset (offline-safe)', () => {
    expect(process.env.SENTRY_DSN).toBeUndefined();
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    expect(() => captureException(new Error('no-op'))).not.toThrow();
  });

  it('scrubs credentials, bodies and PII before sending', () => {
    const event = {
      request: {
        url: 'https://api.repoverse.test/api/v1/repos?token=secret',
        headers: { authorization: 'Bearer secret', cookie: 'refresh_token=secret' },
        cookies: { refresh_token: 'secret' },
        data: { password: 'secret' },
        query_string: 'token=secret',
      },
      user: {
        id: 'user-1',
        email: 'person@example.com',
        username: 'person',
        ip_address: '203.0.113.7',
      },
      breadcrumbs: [{ message: 'navigate to /repos?token=secret' }],
    } as unknown as Event;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.request?.url).toBe('https://api.repoverse.test/api/v1/repos');
    expect(scrubbed.request?.headers).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(scrubbed.user).toEqual({ id: 'user-1' });
    expect(scrubbed.breadcrumbs).toBeUndefined();

    // Nothing secret survives anywhere in the event
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('203.0.113.7');
  });
});
