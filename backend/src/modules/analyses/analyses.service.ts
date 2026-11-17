import { Analysis, AnalysisDocument } from './analysis.model';
import { RepoDocument } from '../repos/repo.model';
import { enqueueAnalysis } from '../../services/analyzer/queue';
import { runAnalysis } from '../../services/analyzer/pipeline';
import { AppError } from '../../utils/appError';
import { env } from '../../config/env';

export function isAnalysisActive(analysis: AnalysisDocument): boolean {
  return (
    analysis.status === 'queued' ||
    analysis.status === 'fetching' ||
    analysis.status === 'parsing' ||
    analysis.status === 'building_graph'
  );
}

/**
 * Creates an analysis record and schedules the pipeline run.
 * Enforces the per-user concurrent cap (1 active analysis) — server-side,
 * not just in the client (PRD §10.4 / §12).
 */
export async function startAnalysisForRepo(
  repo: RepoDocument
): Promise<AnalysisDocument> {
  const active = await Analysis.findOne({
    repoId: repo._id,
    userId: repo.userId,
    isDeleted: false,
    status: { $in: ['queued', 'fetching', 'parsing', 'building_graph'] },
  }).lean();

  if (active) {
    throw new AppError(
      409,
      'ANALYSIS_IN_PROGRESS',
      'An analysis is already running for this repository'
    );
  }

  // Per-user queue ceiling — a user cannot monopolize the global worker
  // queue by registering many repositories at once (PRD §10.4).
  const activeForUser = await Analysis.countDocuments({
    userId: repo.userId,
    isDeleted: false,
    status: { $in: ['queued', 'fetching', 'parsing', 'building_graph'] },
  });

  if (activeForUser >= env.ANALYSIS_MAX_QUEUED_PER_USER) {
    throw new AppError(
      429,
      'ANALYSIS_LIMIT_EXCEEDED',
      `You already have ${activeForUser} analyses queued or running — wait for one to finish before starting another`
    );
  }

  const analysis = await Analysis.create({
    userId: repo.userId,
    repoId: repo._id,
    status: 'queued',
    progress: 0,
  });

  const analysisId = String(analysis._id);
  const userId = String(repo.userId);
  enqueueAnalysis(userId, () => runAnalysis(analysisId));

  return analysis;
}
