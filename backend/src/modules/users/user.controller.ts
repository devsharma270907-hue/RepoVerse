import { Request, Response, NextFunction } from 'express';
import { User } from './user.model';
import { AppError } from '../../utils/appError';
import { env } from '../../config/env';
import {
  describeGithubToken,
  removeGithubToken,
  setGithubToken,
} from './githubToken.service';
import {
  listSessions,
  revokeAllSessions,
  revokeSession,
} from '../auth/auth.service';
import { deleteAccount, exportUserData } from './users.service';
import { requireParam } from '../../middleware/validate';

const REFRESH_COOKIE = 'refresh_token';

const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
};

export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await User.findById(req.user!.id)
      .select('name email createdAt +githubToken')
      .lean();
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }
    res.status(200).json({
      success: true,
      data: {
        user: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          // Connection status only — ciphertext/hint internals never leave
          githubToken: describeGithubToken(user.githubToken),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/v1/users/me/github-token — connect a PAT for private repos. */
export async function setGithubTokenHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const status = await setGithubToken(req.user!.id, req.body.token as string);
    res.status(200).json({ success: true, data: { githubToken: status } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/users/me/github-token — disconnect the stored PAT. */
export async function removeGithubTokenHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await removeGithubToken(req.user!.id);
    res
      .status(200)
      .json({ success: true, data: { githubToken: { connected: false } } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/users/me/sessions — active refresh sessions (no secrets). */
export async function listSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessions = await listSessions(req.user!.id, req.user!.sid);
    res.status(200).json({ success: true, data: { sessions } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/users/me/sessions/:sessionId — revoke one active session. */
export async function revokeSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await revokeSession(req.user!.id, requireParam(req, 'sessionId'));
    if (req.user!.sid === req.params.sessionId) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    }
    res.status(200).json({
      success: true,
      data: { sessionId: req.params.sessionId, revoked: true },
    });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/users/me/sessions — sign out everywhere. */
export async function revokeAllSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await revokeAllSessions(req.user!.id);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    res.status(200).json({
      success: true,
      data: { revoked: 'all', message: 'All sessions revoked' },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/users/me/export — GDPR-style data portability (no secrets). */
export async function exportMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await exportUserData(req.user!.id);
    res
      .status(200)
      .set(
        'Content-Disposition',
        `attachment; filename="repoverse-export-${req.user!.id}.json"`
      )
      .json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/users/me — hard-delete the account and all derived data. */
export async function deleteMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await deleteAccount(req.user!.id);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    res.status(200).json({
      success: true,
      data: { message: 'Account and all associated data deleted' },
    });
  } catch (err) {
    next(err);
  }
}
