import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/users/user.routes';
import reposRoutes from '../modules/repos/repos.routes';
import analysesRoutes from '../modules/analyses/analyses.routes';
import graphRoutes from '../modules/graph/graph.routes';
import insightsRoutes from '../modules/insights/insights.routes';
import aiRoutes from '../modules/ai/ai.routes';
import workspaceRoutes from '../modules/workspace/workspace.routes';
import githubRoutes from '../modules/github/github.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/repos', reposRoutes);
router.use('/analyses', analysesRoutes);
router.use('/graph', graphRoutes);
router.use('/insights', insightsRoutes);
router.use('/ai', aiRoutes);
router.use('/workspace', workspaceRoutes);
router.use('/github', githubRoutes);

export default router;
