import { Request, Response, NextFunction } from 'express';

/**
 * NoSQL injection prevention (blueprint Section 4 — replaces
 * express-mongo-sanitize, which is incompatible with Express 5's
 * getter-only req.query).
 *
 * Strips any key that starts with `$` or contains `.` from req.body,
 * req.query, and req.params — mutating the objects in place instead of
 * reassigning them (reassignment breaks on Express 5).
 */
function isInjectionKey(key: string): boolean {
  return key.startsWith('$') || key.includes('.');
}

function sanitizeInPlace(value: unknown): void {
  if (value === null || typeof value !== 'object') return;

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (isInjectionKey(key)) {
      delete (value as Record<string, unknown>)[key];
    } else {
      sanitizeInPlace((value as Record<string, unknown>)[key]);
    }
  }
}

function mutateReadonly(target: unknown): void {
  if (target === null || typeof target !== 'object') return;
  const obj = target as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (isInjectionKey(key)) {
      delete obj[key];
    } else {
      const inner = obj[key];
      if (inner !== null && typeof inner === 'object') {
        sanitizeInPlace(inner);
      }
    }
  }
}

export function noSqlSanitize(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    if (req.body && typeof req.body === 'object') {
      sanitizeInPlace(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      mutateReadonly(req.query); // getter-only in Express 5 — mutate, never reassign
    }
    if (req.params && typeof req.params === 'object') {
      sanitizeInPlace(req.params);
    }
  } catch {
    // Never let sanitization break the request pipeline
  }
  next();
}
