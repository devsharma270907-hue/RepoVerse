import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { tokenStore, __resetTokenStore } from '@/auth/tokenStore';

vi.mock('@/api/client', () => ({
  AUTH_EXPIRED_EVENT: 'repoverse:auth-expired',
  refreshSession: vi.fn(),
}));

vi.mock('@/api/endpoints', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

import { refreshSession } from '@/api/client';
import { getMe, login as apiLogin, logout as apiLogout } from '@/api/endpoints';

const refreshMock = vi.mocked(refreshSession);
const meMock = vi.mocked(getMe);
const loginMock = vi.mocked(apiLogin);
const logoutMock = vi.mocked(apiLogout);

const user = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function Probe() {
  const { status, user: current, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{current?.email ?? 'none'}</span>
      <button type="button" onClick={() => void login('ada@example.com', 'secret').catch(() => undefined)}>
        sign in
      </button>
      <button type="button" onClick={() => void logout()}>
        sign out
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

describe('<AuthProvider />', () => {
  beforeEach(() => {
    __resetTokenStore();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('boots into anonymous when the refresh cookie is absent', async () => {
    refreshMock.mockRejectedValueOnce(new Error('no cookie'));
    renderProvider();
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    );
    expect(tokenStore.get()).toBeNull();
  });

  it('silently restores an authenticated session', async () => {
    refreshMock.mockImplementationOnce(async () => {
      tokenStore.set('access-token');
      return 'access-token';
    });
    meMock.mockResolvedValueOnce(user);
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    );
    expect(screen.getByTestId('email')).toHaveTextContent('ada@example.com');
    expect(tokenStore.get()).toBe('access-token');
  });

  it('logs in, keeps the access token in memory and clears it on logout', async () => {
    refreshMock.mockRejectedValueOnce(new Error('no cookie'));
    loginMock.mockResolvedValueOnce({ user, accessToken: 'fresh-token' });
    logoutMock.mockResolvedValueOnce(undefined);

    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    );

    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    );
    expect(tokenStore.get()).toBe('fresh-token');

    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    );
    expect(tokenStore.get()).toBeNull();
  });

  it('clears the session when the refresh token is rejected globally', async () => {
    refreshMock.mockImplementationOnce(async () => {
      tokenStore.set('access-token');
      return 'access-token';
    });
    meMock.mockResolvedValueOnce(user);
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    );

    act(() => {
      window.dispatchEvent(new Event('repoverse:auth-expired'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    );
    expect(tokenStore.get()).toBeNull();
  });
});
