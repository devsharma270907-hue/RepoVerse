import * as Sentry from '@sentry/node';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Optional error monitoring (blueprint: Winston + Sentry in production).
 *
 * Disabled unless SENTRY_DSN is set, so local development and the test suite
 * never make network calls. `beforeSend` scrubs request secrets before any
 * event leaves the process — no cookies, auth headers, query strings, bodies,
 * email addresses or IP addresses.
 */

let initialized = false;

export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Last line of defense before an event leaves the process: strips request
 * credentials, bodies, query strings and user PII. Exported for tests.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (typeof event.request.url === 'string') {
      event.request.url = event.request.url.split('?')[0];
    }
  }

  // Keep only the opaque user id — never email, username or IP.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  // Breadcrumbs may embed request metadata (URLs, console args).
  delete event.breadcrumbs;
  return event;
}

export function initSentry(): boolean {
  if (initialized) return true;
  if (!env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubSentryEvent,
  });

  initialized = true;
  logger.info('Sentry error monitoring enabled');
  return true;
}

/** Reports an unexpected error; no-op when Sentry is not configured. */
export function captureException(err: unknown): void {
  if (!initialized) return;
  Sentry.captureException(err);
}

/** Flushes buffered events during graceful shutdown. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Monitoring must never block shutdown
  }
}
