import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { env } from '../../config/env';
import { initPassport, isGoogleOAuthEnabled } from '../../config/passport';
import { issueTokens } from './auth.service';
import { createOAuthState, verifyOAuthState } from './oauthState';

/**
 * Google OAuth endpoints (PRD §6 — Google OAuth + Email/Password).
 * Session-less Passport flow:
 *  1. GET /google          → CSRF state (HMAC + HttpOnly cookie) + redirect
 *  2. Google consent       → GET /google/callback?code&state
 *  3. state validated FIRST (timing-safe, cookie-bound) → token exchange
 *  4. issue OUR JWT pair — refresh cookie + access token in the redirect
 *     fragment (never a query param; the frontend clears it on read).
 */

const STATE_COOKIE = 'g_state';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const CLIENT_CALLBACK_PATH = '/oauth/callback';

const stateCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  // Lax (not Strict): the cookie must travel back on the cross-site
  // top-level navigation from accounts.google.com to the callback
  sameSite: 'lax' as const,
  path: '/',
  maxAge: STATE_MAX_AGE_MS,
};

function toClientRedirect(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${env.CLIENT_URL}${CLIENT_CALLBACK_PATH}?${query}`;
}

/** GET /api/v1/auth/google — kicks off the Google consent redirect. */
export function googleAuth(req: Request, res: Response): void {
  if (!isGoogleOAuthEnabled()) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Google login is not configured' },
    });
    return;
  }

  const state = createOAuthState();
  res.cookie(STATE_COOKIE, state, stateCookieOptions);

  passport.authenticate('google', {
    session: false,
    state, // passport-oauth2 sends it verbatim; WE validate it in the callback
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })(req, res);
}

/** GET /api/v1/auth/google/callback — exchanges the code for OUR tokens. */
export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  if (!isGoogleOAuthEnabled()) {
    res.redirect(toClientRedirect({ error: 'not_configured' }));
    return;
  }

  // 1. CSRF state gate — runs BEFORE any network call to Google
  try {
    verifyOAuthState(
      typeof req.query.state === 'string' ? req.query.state : undefined,
      typeof req.cookies?.[STATE_COOKIE] === 'string' ? req.cookies[STATE_COOKIE] : undefined
    );
  } catch {
    res.clearCookie(STATE_COOKIE, { ...stateCookieOptions, maxAge: undefined });
    res.redirect(toClientRedirect({ error: 'state_mismatch' }));
    return;
  }
  res.clearCookie(STATE_COOKIE, { ...stateCookieOptions, maxAge: undefined });

  // 2. Passport exchange (code → Google tokens → profile → user upsert)
  passport.authenticate('google', { session: false }, async (err, user) => {
    try {
      if (err || !user) {
        res.redirect(toClientRedirect({ error: 'google_denied' }));
        return;
      }

      // 3. Issue OUR session (same mechanism as email/password login)
      const ua = req.headers['user-agent'];
      const tokens = await issueTokens(
        user as Parameters<typeof issueTokens>[0],
        typeof ua === 'string' ? { userAgent: ua.slice(0, 300) } : {}
      );
      res.cookie('refresh_token', tokens.refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // Access token goes in the FRAGMENT (never logged, never hits our
      // server again); the frontend reads + clears it per blueprint
      res.redirect(`${env.CLIENT_URL}${CLIENT_CALLBACK_PATH}#accessToken=${tokens.accessToken}`);
    } catch (cbErr) {
      next(cbErr);
    }
  })(req, res);
}

// Strategy registration is idempotent and env-gated
initPassport();
