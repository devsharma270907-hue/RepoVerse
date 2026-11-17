import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AUTH_EXPIRED_EVENT, refreshSession } from '@/api/client';
import {
  getMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
} from '@/api/endpoints';
import type { User } from '@/api/types';
import { toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';
import { tokenStore } from './tokenStore';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  busy: boolean;
  error: AppError | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  completeOAuth: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  // Bootstrap: the refresh cookie is the only persisted credential, so a
  // reload silently restores the session via rotation.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      try {
        if (!tokenStore.get()) {
          await refreshSession();
        }
        const me = await getMe();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        tokenStore.clear();
        setUser(null);
        setStatus('anonymous');
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed refresh anywhere in the app ends the session consistently.
  useEffect(() => {
    const handleExpired = (): void => {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiLogin({ email, password });
      tokenStore.set(result.accessToken);
      setUser(result.user);
      setStatus('authenticated');
    } catch (err) {
      const appError = toAppError(err);
      setError(appError);
      throw appError;
    } finally {
      setBusy(false);
    }
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await apiRegister({ name, email, password });
        tokenStore.set(result.accessToken);
        setUser(result.user);
        setStatus('authenticated');
      } catch (err) {
        const appError = toAppError(err);
        setError(appError);
        throw appError;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const completeOAuth = useCallback(async (accessToken: string) => {
    setBusy(true);
    setError(null);
    try {
      tokenStore.set(accessToken);
      const me = await getMe();
      setUser(me);
      setStatus('authenticated');
    } catch (err) {
      const appError = toAppError(err);
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
      setError(appError);
      throw appError;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await apiLogout();
    } catch {
      // Best-effort: the local session is cleared regardless.
    } finally {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
      setBusy(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await getMe();
    setUser(me);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      busy,
      error,
      login,
      register,
      completeOAuth,
      logout,
      refreshUser,
      clearError,
    }),
    [
      user,
      status,
      busy,
      error,
      login,
      register,
      completeOAuth,
      logout,
      refreshUser,
      clearError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
