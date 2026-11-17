import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { User } from '../modules/users/user.model';

/**
 * JWT auth guard (blueprint Section 2 — middleware/requireAuth.ts).
 * Verifies the Bearer access token, loads the user, and attaches req.user.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'No token provided');
    }

    const token = header.slice('Bearer '.length).trim();

    let payload: { sub: string; sid?: string };
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
      }
      throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid');
    }

    const user = await User.findById(payload.sub).select('name email').lean();
    if (!user) {
      throw new AppError(401, 'TOKEN_INVALID', 'Access token invalid');
    }

    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      ...(payload.sid ? { sid: payload.sid } : {}),
    };
    next();
  } catch (err) {
    next(err);
  }
}
