import { Request, Response, NextFunction } from 'express';
import * as reposService from './repos.service';
import { Analysis } from '../analyses/analysis.model';
import { Repo } from './repo.model';
import { assertOwnership } from '../../utils/ownershipCheck';
import { requireParam } from '../../middleware/validate';

export function toPublicRepo(repo: {
  _id: unknown;
  githubOwner: string;
  githubName: string;
  url: string;
  branch: string;
  defaultBranch?: string;
  sizeKb?: number;
  isPrivate?: boolean;
  createdAt: Date;
}) {
  return {
    id: String(repo._id),
    owner: repo.githubOwner,
    name: repo.githubName,
    url: repo.url,
    branch: repo.branch,
    defaultBranch: repo.defaultBranch,
    sizeKb: repo.sizeKb,
    isPrivate: repo.isPrivate ?? false,
    createdAt: repo.createdAt,
  };
}

export function toPublicAnalysis(analysis: {
  _id: unknown;
  repoId: unknown;
  status: string;
  progress: number;
  commitSha?: string;
  error?: { code: string; message: string } | null;
  summary?: unknown;
  createdAt: Date;
  finishedAt?: Date | null;
}) {
  return {
    id: String(analysis._id),
    repoId: String(analysis.repoId),
    status: analysis.status,
    progress: analysis.progress,
    commitSha: analysis.commitSha,
    error: analysis.error ?? null,
    summary: analysis.summary ?? null,
    createdAt: analysis.createdAt,
    finishedAt: analysis.finishedAt ?? null,
  };
}

/** POST /api/v1/repos — register + queue analysis → 202 Accepted (PRD §11) */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { repo, analysis, created } = await reposService.registerRepo(
      req.user!.id,
      req.body
    );
    res.status(202).json({
      success: true,
      data: {
        created,
        repo: toPublicRepo(repo),
        analysis: toPublicAnalysis(analysis),
        // Convenience aliases for clients that poll immediately
        repoId: String(repo._id),
        analysisId: String(analysis._id),
        status: analysis.status,
        progress: analysis.progress,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/repos/:id/refresh — re-run analysis */
export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await assertOwnership(Repo, requireParam(req, 'id'), req.user!.id);
    const analysis = await reposService.refreshRepo(repo);
    res.status(202).json({
      success: true,
      data: {
        analysis: toPublicAnalysis(analysis),
        repoId: String(repo._id),
        analysisId: String(analysis._id),
        status: analysis.status,
        progress: analysis.progress,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/repos — paginated list */
export async function list(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const { repos, total } = await reposService.listRepos(
      req.user!.id,
      page,
      limit
    );
    res.status(200).json({
      success: true,
      data: repos.map(toPublicRepo),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/repos/:id */
export async function get(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await reposService.getRepoOrThrow(req.user!.id, requireParam(req, 'id'));
    res.status(200).json({ success: true, data: { repo: toPublicRepo(repo) } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/repos/:id — soft delete (blueprint Section 6) */
export async function remove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await reposService.getRepoOrThrow(req.user!.id, requireParam(req, 'id'));
    await reposService.softDeleteRepo(repo);
    res
      .status(200)
      .json({ success: true, data: { id: String(repo._id), deleted: true } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/repos/:id/analyses — analysis history for a repo */
export async function listAnalyses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const repo = await reposService.getRepoOrThrow(req.user!.id, requireParam(req, 'id'));
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const filter = { repoId: repo._id, userId: req.user!.id, isDeleted: false };
    const [analyses, total] = await Promise.all([
      Analysis.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Analysis.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: analyses.map((a) => toPublicAnalysis({ ...a, error: a.error ?? null })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (err) {
    next(err);
  }
}
