import { Router } from 'express';
import { get } from './analyses.controller';
import {
  createPin,
  getReport,
  listPins,
} from '../workspace/workspace.controller';
import {
  createPinSchema,
  reportQuerySchema,
} from '../workspace/workspace.schema';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../repos/repos.schema';

const router = Router();

router.use('/', requireAuth);

// GET /api/v1/analyses/:id — poll analysis status/progress
router.get('/:id', validate(idParamSchema), get);

// GET /api/v1/analyses/:id/pins — pinned findings (PRD Phase 3)
router.get('/:id/pins', validate(idParamSchema), listPins);
router.post(
  '/:id/pins',
  validate({ ...idParamSchema, ...createPinSchema }),
  createPin
);

// GET /api/v1/analyses/:id/report?format=json|markdown — export report
router.get(
  '/:id/report',
  validate({ ...idParamSchema, ...reportQuerySchema }),
  getReport
);

export default router;
