import type { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import {
  fieldError,
  friendlyMessage,
  NETWORK_ERROR,
  toAppError,
} from '@/lib/errors';

function axiosError(overrides: Record<string, unknown>): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed',
    ...overrides,
  } as unknown as AxiosError;
}

describe('error normalisation', () => {
  it('maps a server error envelope', () => {
    const error = toAppError(
      axiosError({
        response: {
          status: 400,
          data: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              fields: { 'body.email': ['Invalid email address'] },
            },
          },
        },
      })
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
    expect(error.message).toBe('Validation failed');
    expect(error.fields?.['body.email']).toEqual(['Invalid email address']);
  });

  it('flattens a single string field message into an array', () => {
    const error = toAppError(
      axiosError({
        response: {
          status: 422,
          data: { error: { code: 'BAD', message: 'No', fields: { url: 'Required' } } },
        },
      })
    );
    expect(error.fields?.url).toEqual(['Required']);
  });

  it('handles requests that never reached the server', () => {
    const error = toAppError(axiosError({ code: 'ERR_NETWORK' }));
    expect(error).toEqual(NETWORK_ERROR);
  });

  it('handles timeouts', () => {
    const error = toAppError(axiosError({ code: 'ECONNABORTED' }));
    expect(error.code).toBe('TIMEOUT');
  });

  it('falls back for non-envelope HTTP errors', () => {
    const error = toAppError(
      axiosError({ response: { status: 502, data: '<html>bad gateway</html>' } })
    );
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.message).toContain('502');
  });

  it('passes through plain Errors', () => {
    expect(toAppError(new Error('boom'))).toMatchObject({
      code: 'CLIENT_ERROR',
      message: 'boom',
    });
  });

  it('normalises unknown throws', () => {
    expect(toAppError(42).code).toBe('UNKNOWN_ERROR');
  });

  it('reads field errors from body, query and params scopes', () => {
    const error = {
      code: 'VALIDATION_ERROR',
      message: 'bad',
      fields: {
        'body.name': ['Name required'],
        'query.page': ['Too small'],
        'params.id': ['Invalid id'],
      },
    };

    expect(fieldError(error, 'name')).toBe('Name required');
    expect(fieldError(error, 'page')).toBe('Too small');
    expect(fieldError(error, 'id')).toBe('Invalid id');
    expect(fieldError(error, 'missing')).toBeUndefined();
    expect(fieldError(null, 'name')).toBeUndefined();
  });

  it('prefers product copy for known codes', () => {
    expect(
      friendlyMessage({ code: 'REPO_TOO_LARGE', message: 'server text' })
    ).toContain('exceeds');
    expect(friendlyMessage({ code: 'SOMETHING_NEW', message: 'server text' })).toBe(
      'server text'
    );
  });
});
