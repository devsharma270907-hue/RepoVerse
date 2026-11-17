import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import * as authService from './auth.service';
import { AppError } from '../../utils/appError';
import { UserDocument } from '../users/user.model';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Refresh token travels in an HttpOnly; Secure; SameSite=Strict cookie
 * scoped to the auth path (blueprint Section 6 — Authentication).
 */
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: REFRESH_MAX_AGE_MS,
};

function toPublicUser(user: UserDocument) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

/** Optional display metadata captured from the request (never trusted for auth). */
function sessionContext(req: Request): { userAgent?: string } {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? { userAgent: ua.slice(0, 300) } : {};
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { user, tokens } = await authService.registerUser(
      req.body,
      sessionContext(req)
    );
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
    res.status(201).json({
      success: true,
      data: { user: toPublicUser(user), accessToken: tokens.accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { user, tokens } = await authService.loginUser(
      req.body,
      sessionContext(req)
    );
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
    res.status(200).json({
      success: true,
      data: { user: toPublicUser(user), accessToken: tokens.accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new AppError(401, 'UNAUTHORIZED', 'No refresh token provided');
    }

    const tokens = await authService.rotateRefreshToken(
      rawToken,
      sessionContext(req)
    );
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
    res.status(200).json({
      success: true,
      data: { accessToken: tokens.accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (typeof rawToken === 'string' && rawToken.length > 0) {
      await authService.logoutRefreshToken(rawToken);
    }
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
    res.status(200).json({
      success: true,
      data: { message: 'Logged out' },
    });
  } catch (err) {
    next(err);
  }
}
