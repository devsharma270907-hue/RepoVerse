import { Router } from 'express';
import { discover, discoverQuerySchema } from './github.controller';
import { requireAuth } from '../../middleware/requireAuth';
import { validate } from '../../middleware/validate';

const router = Router();

router.use('/', requireAuth);

// GET /api/v1/github/repos?q=&owner=&page=&limit= — repository discovery
router.get('/repos', validate(discoverQuerySchema), discover);

export default router;
