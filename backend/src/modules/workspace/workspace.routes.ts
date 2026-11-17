import { Router } from 'express';
import {
  deletePin,
  deleteView,
  getView,
  updatePin,
  updateView,
} from './workspace.controller';
import {
  updatePinSchema,
  updateSavedViewSchema,
} from './workspace.schema';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../repos/repos.schema';

const router = Router();

router.use('/', requireAuth);

// Saved views
router.get('/views/:id', validate(idParamSchema), getView);
router.patch(
  '/views/:id',
  validate({ ...idParamSchema, ...updateSavedViewSchema }),
  updateView
);
router.delete('/views/:id', validate(idParamSchema), deleteView);

// Pinned findings
router.patch(
  '/pins/:id',
  validate({ ...idParamSchema, ...updatePinSchema }),
  updatePin
);
router.delete('/pins/:id', validate(idParamSchema), deletePin);

export default router;
