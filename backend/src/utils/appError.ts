/**
 * Application error with the standard API error shape
 * (blueprint Section 4 — Standard Error Response Shape).
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace?.(this, AppError);
  }
}

export const notFound = (message = 'Resource not found') =>
  new AppError(404, 'NOT_FOUND', message);

export const unauthorized = (message = 'No token provided') =>
  new AppError(401, 'UNAUTHORIZED', message);
