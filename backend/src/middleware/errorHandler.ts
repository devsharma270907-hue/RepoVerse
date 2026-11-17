import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/appError';
import { captureException } from '../config/sentry';

/**
 * Central error handler (blueprint Section 4 — always mounted last).
 * Every error leaves the API in the standard shape:
 *   { success: false, error: { code, message, fields? } }
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) captureException(err);
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    });
    return;
  }

  // body-parser JSON syntax error → client error, not a server fault
  const parseErr = err as { type?: string };
  if (parseErr?.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Malformed JSON body' },
    });
    return;
  }

  // Mongoose duplicate-key → standard conflict
  const known = err as { code?: unknown; message?: string };
  if (known?.code === 11000) {
    res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Duplicate resource' },
    });
    return;
  }

  // Log WITHOUT any request body / token content (see utils/logger.ts rules)
  logger.error(
    'Unhandled error',
    err instanceof Error ? err : new Error(String(err))
  );
  captureException(err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'Internal server error'
          : (known?.message ?? 'Internal server error'),
    },
  });
}
