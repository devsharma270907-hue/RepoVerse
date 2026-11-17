import { Router } from 'express';
import { register, login, refresh, logout } from './auth.controller';
import { googleAuth, googleCallback } from './oauth.controller';
import { registerSchema, loginSchema } from './auth.schema';
import { validate } from '../../middleware/validate';

const router = Router();

// POST /api/v1/auth/register — create account, sets refresh cookie
router.post('/register', validate(registerSchema), register);

// POST /api/v1/auth/login — authenticate, sets refresh cookie
router.post('/login', validate(loginSchema), login);

// POST /api/v1/auth/refresh — rotate refresh token, returns new access token
router.post('/refresh', refresh);

// POST /api/v1/auth/logout — revoke current refresh session, clears cookie
router.post('/logout', logout);

// GET /api/v1/auth/google — start Google OAuth (404 when not configured)
router.get('/google', googleAuth);

// GET /api/v1/auth/google/callback — Google redirects here with ?code&state
router.get('/google/callback', googleCallback);

export default router;
