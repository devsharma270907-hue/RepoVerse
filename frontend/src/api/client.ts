import axios, { AxiosHeaders, isAxiosError } from 'axios';
import type { AxiosError } from 'axios';
import { apiRoot } from '@/lib/env';
import { tokenStore } from '@/auth/tokenStore';
import type { ApiSuccess } from './types';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Internal marker used by the refresh interceptor to prevent loops. */
    _retry?: boolean;
  }
}

/** Fired when the refresh token itself is no longer valid. */
export const AUTH_EXPIRED_EVENT = 'repoverse:auth-expired';

const AUTH_PATHS_WITHOUT_RETRY = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
];

/** Shared API instance. Credentials are required for the refresh cookie. */
export const api = axios.create({
  baseURL: apiRoot,
  withCredentials: true,
  timeout: 30_000,
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers = AxiosHeaders.from(config.headers);
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

/**
 * Rotates the refresh cookie and returns a fresh access token.
 * Single-flight: concurrent 401s share one refresh request, which is required
 * because the backend treats token reuse as a breach and revokes sessions.
 */
export function refreshSession(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  const request = axios
    .post<ApiSuccess<{ accessToken: string }>>(
      `${apiRoot}/auth/refresh`,
      undefined,
      { withCredentials: true, timeout: 15_000 }
    )
    .then((response) => {
      const token = response.data.data.accessToken;
      tokenStore.set(token);
      return token;
    })
    .finally(() => {
      if (refreshPromise === request) refreshPromise = null;
    });

  refreshPromise = request;
  return request;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config;
    if (!config || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const url = config.url ?? '';
    if (
      config._retry ||
      AUTH_PATHS_WITHOUT_RETRY.some((path) => url.includes(path))
    ) {
      return Promise.reject(error);
    }

    config._retry = true;

    try {
      const token = await refreshSession();
      config.headers = AxiosHeaders.from(config.headers);
      config.headers.set('Authorization', `Bearer ${token}`);
      return await api.request(config);
    } catch {
      tokenStore.clear();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      return Promise.reject(error);
    }
  }
);

/** True for 4xx errors that must not be retried by TanStack Query. */
export function isClientError(error: unknown): boolean {
  return isAxiosError(error) && (error.response?.status ?? 0) >= 400 && (error.response?.status ?? 0) < 500;
}
