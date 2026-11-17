import { Router } from 'express';
import { explainNode, smartSearch } from './ai.controller';
import { explainSchema, searchSchema } from './ai.schema';
import { requireAuth } from '../../middleware/requireAuth';
import { aiBudget } from '../../middleware/aiBudget';
import { aiRateLimit } from '../../middleware/rateLimiters';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../repos/repos.schema';

const router = Router();

// Auth + per-minute rate limit + per-user monthly token budget on every
// AI call (PRD §9)
router.use('/analyses/:id', requireAuth, aiRateLimit, aiBudget);

// POST /api/v1/ai/analyses/:id/explain — grounded AI explanation
router.post(
  '/analyses/:id/explain',
  validate({ ...idParamSchema, ...explainSchema }),
  explainNode
);

// POST /api/v1/ai/analyses/:id/search — Smart Search (keyword + LLM synthesis)
router.post(
  '/analyses/:id/search',
  validate({ ...idParamSchema, ...searchSchema }),
  smartSearch
);

export default router;
