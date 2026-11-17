import { Router } from 'express';
import {
  deleteMe,
  exportMe,
  getMe,
  listSessionsHandler,
  removeGithubTokenHandler,
  revokeAllSessionsHandler,
  revokeSessionHandler,
  setGithubTokenHandler,
} from './user.controller';
import { deleteAccountSchema, githubTokenSchema } from './user.schema';
import { sessionIdParamSchema } from '../workspace/workspace.schema';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';

const router = Router();

// GET /api/v1/users/me — current authenticated user's profile
router.get('/me', requireAuth, getMe);

// GET /api/v1/users/me/export — GDPR data portability
router.get('/me/export', requireAuth, exportMe);

// Active refresh sessions (view + revoke) — blueprint session management
router.get('/me/sessions', requireAuth, listSessionsHandler);
router.delete('/me/sessions', requireAuth, revokeAllSessionsHandler);
router.delete(
  '/me/sessions/:sessionId',
  requireAuth,
  validate(sessionIdParamSchema),
  revokeSessionHandler
);

// PUT /api/v1/users/me/github-token — connect a PAT (encrypted at rest)
router.put(
  '/me/github-token',
  requireAuth,
  validate(githubTokenSchema),
  setGithubTokenHandler
);

// DELETE /api/v1/users/me/github-token — forget the stored PAT
router.delete('/me/github-token', requireAuth, removeGithubTokenHandler);

// DELETE /api/v1/users/me — hard delete (requires typed confirmation)
router.delete(
  '/me',
  requireAuth,
  validate(deleteAccountSchema),
  deleteMe
);

export default router;
