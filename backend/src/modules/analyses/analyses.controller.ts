import { Request, Response, NextFunction } from 'express';
import { Analysis } from './analysis.model';
import { assertOwnership } from '../../utils/ownershipCheck';
import { toPublicAnalysis } from '../repos/repos.controller';
import { requireParam } from '../../middleware/validate';

/** GET /api/v1/analyses/:id — status/progress polling endpoint */
export async function get(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const analysis = await assertOwnership(
      Analysis,
      requireParam(req, 'id'),
      req.user!.id
    );
    res
      .status(200)
      .json({ success: true, data: { analysis: toPublicAnalysis(analysis) } });
  } catch (err) {
    next(err);
  }
}
