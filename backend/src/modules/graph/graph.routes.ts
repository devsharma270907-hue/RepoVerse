import { Router } from 'express';
import {
  getGraph,
  getGraphCallers,
  getGraphNode,
  getGraphTree,
} from './graph.controller';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../repos/repos.schema';
import { z } from 'zod';

const router = Router();

router.use('/', requireAuth);

const nodeQuerySchema = {
  query: z.object({
    node: z.string().trim().min(1, 'node query parameter is required'),
  }),
};

// GET /api/v1/graph/:id/tree — nested structural map (PRD §4.1)
router.get('/:id/tree', validate(idParamSchema), getGraphTree);

// GET /api/v1/graph/:id/node?node=<key> — node inspector (PRD §4.2)
router.get('/:id/node', validate({ ...idParamSchema, ...nodeQuerySchema }), getGraphNode);

// GET /api/v1/graph/:id/callers?node=<key>&depth=1 — reverse traversal
router.get(
  '/:id/callers',
  validate({
    ...idParamSchema,
    query: z.object({
      node: z.string().trim().min(1, 'node query parameter is required'),
      depth: z.coerce.number().int().min(1).max(5).default(1),
    }),
  }),
  getGraphCallers
);

// GET /api/v1/graph/:id?level=file|symbol — map data for an analysis
router.get(
  '/:id',
  validate({
    ...idParamSchema,
    query: z.object({
      level: z.enum(['file', 'symbol']).default('file').optional(),
    }),
  }),
  getGraph
);

export default router;
