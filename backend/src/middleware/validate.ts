import { Request, Response, NextFunction } from 'express';
import { z, ZodType } from 'zod';
import { AppError } from '../utils/appError';

type SchemaMap = {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
};

/**
 * Zod validation factory (blueprint Section 2 — middleware/validate.ts).
 * Validates req.body / req.query / req.params → 400 with per-field errors.
 * Parsed body replaces req.body; query/params are validated but not reassigned
 * (Express 5 exposes req.query as a getter-only property).
 */
export function validate(schemas: SchemaMap) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const fields: Record<string, string[]> = {};

    const collect = (prefix: 'query' | 'params', error: z.ZodError): void => {
      const fieldErrors = z.flattenError(error).fieldErrors;
      for (const [key, messages] of Object.entries(fieldErrors)) {
        fields[`${prefix}.${key}`] = messages as string[];
      }
    };

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        for (const [key, messages] of Object.entries(z.flattenError(result.error).fieldErrors)) {
          fields[key] = messages as string[];
        }
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) collect('query', result.error);
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) collect('params', result.error);
    }

    if (Object.keys(fields).length > 0) {
      next(new AppError(400, 'VALIDATION_ERROR', 'Validation failed', fields));
      return;
    }

    next();
  };
}

/**
 * Reads a validated path parameter as a string. Express 5 types params as
 * string | string[] — route validation (idParamSchema) guarantees a string
 * for matched routes; this guard keeps the type system honest as well.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(400, 'INVALID_REQUEST', `Missing path parameter: ${name}`);
  }
  return value;
}
