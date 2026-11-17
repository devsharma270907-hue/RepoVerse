import { Router } from 'express';
import {
  register,
  list,
  get,
  remove,
  refresh,
  listAnalyses,
} from './repos.controller';
import { requireAuth } from '../../middleware/requireAuth';
import { analysisRateLimit } from '../../middleware/rateLimiters';
import { validate } from '../../middleware/validate';
import {
  registerRepoSchema,
  idParamSchema,
  listQuerySchema,
} from './repos.schema';
import { createView, listViews } from '../workspace/workspace.controller';
import { createSavedViewSchema } from '../workspace/workspace.schema';

const router = Router();

// All repo routes require authentication
router.use('/', requireAuth);

// POST /api/v1/repos — register repo + queue analysis (202)
router.post('/', analysisRateLimit, validate(registerRepoSchema), register);

// GET /api/v1/repos?page=&limit= — paginated list
router.get('/', validate(listQuerySchema), list);

// GET /api/v1/repos/:id
router.get('/:id', validate(idParamSchema), get);

// POST /api/v1/repos/:id/refresh — re-run analysis (202 or 409 if active)
router.post(
  '/:id/refresh',
  analysisRateLimit,
  validate({ ...idParamSchema }),
  refresh
);

// GET /api/v1/repos/:id/analyses — analysis history
router.get(
  '/:id/analyses',
  validate({ ...idParamSchema, ...listQuerySchema }),
  listAnalyses
);

// Saved workspace views (PRD Phase 3)
router.get('/:id/views', validate(idParamSchema), listViews);
router.post(
  '/:id/views',
  validate({ ...idParamSchema, ...createSavedViewSchema }),
  createView
);

// DELETE /api/v1/repos/:id — soft delete
router.delete('/:id', validate(idParamSchema), remove);

export default router;
