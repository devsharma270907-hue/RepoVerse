import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { discoverRepos } from '../../services/analyzer/fetcher';
import { resolveUserGithubToken } from '../users/githubToken.service';
import { AppError } from '../../utils/appError';

/**
 * GitHub repository discovery (PRD §4.9 — repo picker in the command palette).
 *
 * Read-only metadata search: users find a repository here, then register it
 * through POST /api/v1/repos, which applies the full validation pipeline.
 * The caller's stored PAT is used when present so private repos they can
 * access are discoverable; no token is ever returned.
 */

export const discoverQuerySchema = {
  query: z.object({
    q: z.string().trim().max(200).optional(),
    owner: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/, 'owner must be a GitHub login')
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
};

/** GET /api/v1/github/repos?q=&owner=&page=&limit= */
export async function discover(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = req.query.q ? String(req.query.q).trim() : undefined;
    const owner = req.query.owner ? String(req.query.owner).trim() : undefined;

    if (!query && !owner) {
      throw new AppError(
        400,
        'INVALID_REQUEST',
        'Provide q (search text), owner (GitHub login), or both'
      );
    }

    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit ?? 20) || 20, 1),
      50
    );

    const token = await resolveUserGithubToken(req.user!.id);
    const { repos, total } = await discoverRepos({
      ...(query ? { query } : {}),
      ...(owner ? { owner } : {}),
      page,
      limit,
      token,
    });

    res.status(200).json({
      success: true,
      data: {
        repos,
        query: query ?? null,
        owner: owner ?? null,
      },
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
