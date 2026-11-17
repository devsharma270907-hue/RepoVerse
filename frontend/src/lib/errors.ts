import { AxiosError, isAxiosError } from 'axios';

export interface AppError {
  code: string;
  message: string;
  status?: number;
  fields?: Record<string, string[]>;
}

export const NETWORK_ERROR: AppError = {
  code: 'NETWORK_ERROR',
  message: 'Cannot reach the RepoVerse API. Check your connection and that the backend is running.',
};

/** Converts any thrown value into the app's normalized error shape. */
export function toAppError(error: unknown): AppError {
  if (isAxiosError(error)) {
    return fromAxiosError(error);
  }
  if (error instanceof Error) {
    return { code: 'CLIENT_ERROR', message: error.message };
  }
  return { code: 'UNKNOWN_ERROR', message: 'Something went wrong.' };
}

function fromAxiosError(error: AxiosError): AppError {
  if (error.code === 'ECONNABORTED') {
    return {
      code: 'TIMEOUT',
      message: 'The request timed out. The server may be busy — try again.',
    };
  }

  if (!error.response) {
    return NETWORK_ERROR;
  }

  const { status, data } = error.response;
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    data.error &&
    typeof data.error === 'object'
  ) {
    const body = data as {
      error: { code?: unknown; message?: unknown; fields?: unknown };
    };
    return {
      code: typeof body.error.code === 'string' ? body.error.code : 'HTTP_ERROR',
      message:
        typeof body.error.message === 'string'
          ? body.error.message
          : `Request failed with status ${status}`,
      status,
      fields: normalizeFields(body.error.fields),
    };
  }

  return {
    code: 'HTTP_ERROR',
    message: `Request failed with status ${status}`,
    status,
  };
}

function normalizeFields(
  value: unknown
): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      result[key] = messages.map(String);
    } else if (typeof messages === 'string') {
      result[key] = [messages];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Human-friendly copy for known server error codes. */
const ERROR_HINTS: Record<string, string> = {
  AI_BUDGET_EXCEEDED:
    'You have reached the monthly AI token budget for this account.',
  AI_NOT_CONFIGURED:
    'AI features are disabled on this server because no Anthropic API key is configured.',
  AI_PROVIDER_ERROR:
    'The AI provider failed or timed out. Try again in a moment.',
  ANALYSIS_IN_PROGRESS: 'An analysis for this repository is already running.',
  ANALYSIS_LIMIT_EXCEEDED:
    'You have reached the limit of concurrent analyses. Wait for one to finish.',
  ANALYSIS_NOT_READY: 'This analysis has not finished yet.',
  ANALYSIS_TIMEOUT: 'The analysis exceeded its time budget.',
  ACCOUNT_LOCKED:
    'Too many failed sign-in attempts. Try again in a few minutes.',
  GITHUB_TOKEN_INVALID: 'GitHub rejected this token.',
  GITHUB_UNAVAILABLE: 'GitHub is unreachable right now.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  RATE_LIMIT_EXCEEDED: 'Rate limit reached. Please wait before trying again.',
  REPO_NOT_ACCESSIBLE:
    'This repository is missing, private without a connected token, or GitHub is rate limiting us.',
  REPO_TOO_LARGE:
    'This repository exceeds the configured size or file-count limits.',
  REPO_UNSUPPORTED_LANGUAGE:
    'No parseable TypeScript, JavaScript or Python source files were found.',
};

export function friendlyMessage(error: AppError): string {
  return ERROR_HINTS[error.code] ?? error.message;
}

/** First field error for a form field (`body.email` or `email`). */
export function fieldError(
  error: AppError | null,
  field: string
): string | undefined {
  if (!error?.fields) return undefined;
  return (
    error.fields[field]?.[0] ??
    error.fields[`body.${field}`]?.[0] ??
    error.fields[`query.${field}`]?.[0] ??
    error.fields[`params.${field}`]?.[0]
  );
}
