import { Router } from 'express';
import { getCycles, getHealth, getImpact } from './insights.controller';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../repos/repos.schema';
import { impactQuerySchema } from './insights.controller';

const router = Router();

router.use('/', requireAuth);

// GET /api/v1/insights/:id/cycles — circular dependency report
router.get('/:id/cycles', validate(idParamSchema), getCycles);

// GET /api/v1/insights/:id/health — per-file health scores + repo score
router.get('/:id/health', validate(idParamSchema), getHealth);

// GET /api/v1/insights/:id/impact?node=<file path> — transitive dependents
router.get(
  '/:id/impact',
  validate({ ...idParamSchema, ...impactQuerySchema }),
  getImpact
);

export default router;
