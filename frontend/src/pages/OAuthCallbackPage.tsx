import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Spinner } from '@/components/ui';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { toAppError } from '@/lib/errors';
import type { AppError } from '@/lib/errors';

const ERROR_COPY: Record<string, string> = {
  state_mismatch: 'The OAuth state check failed. Start the Google sign-in flow again.',
  not_configured: 'Google sign-in is not configured on this server.',
  google_denied: 'Google sign-in was cancelled or denied.',
  missing_token: 'The sign-in response did not include an access token.',
  session_failed: 'Signed in with Google, but the session could not be established.',
};

export function OAuthCallbackPage() {
  const { status, completeOAuth } = useAuth();
  const navigate = useNavigate();

  const [token] = useState(() =>
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('accessToken')
  );
  const [providerError] = useState(() =>
    new URLSearchParams(window.location.search).get('error')
  );
  const [error, setError] = useState<AppError | null>(null);

  // Strip the fragment immediately: tokens must not linger in the address bar
  // or browser history.
  useEffect(() => {
    window.history.replaceState(null, '', '/oauth/callback');
  }, []);

  useEffect(() => {
    if (status === 'loading') return;

    if (!token) {
      setError({
        code: 'OAUTH_FAILED',
        message: ERROR_COPY[providerError ?? 'missing_token'] ?? ERROR_COPY.missing_token ?? '',
      });
      return;
    }

    let cancelled = false;
    completeOAuth(token)
      .then(() => {
        if (!cancelled) navigate('/', { replace: true });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            toAppError(err).code === 'CLIENT_ERROR'
              ? {
                  code: 'OAUTH_FAILED',
                  message: ERROR_COPY.session_failed ?? 'Session could not be established.',
                }
              : toAppError(err)
          );
        }
      });

    return () => {
      cancelled = true;
    };
    // completeOAuth is stable; re-running on status changes would re-consume
    // the token, so it is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, providerError, navigate]);

  return (
    <AuthLayout
      title="Finishing sign-in"
      subtitle="Verifying your Google session and creating the refresh cookie."
      footer={
        <p>
          Trouble signing in? <Link to="/login">Return to sign in</Link>
        </p>
      }
    >
      <div className="oauth-status">
        {error ? (
          <>
            <p className="oauth-status__error" role="alert">
              {error.message}
            </p>
            <Button variant="primary" onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </Button>
          </>
        ) : (
          <Spinner label="Completing secure sign-in…" />
        )}
      </div>
    </AuthLayout>
  );
}
