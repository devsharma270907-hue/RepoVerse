import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { AppError } from '../utils/appError';
import { AiUsage } from '../modules/ai/usage.model';

/**
 * aiRateLimit (PRD §9/§10.4) — per-user monthly AI token budget,
 * enforced server-side before any LLM call is made.
 *
 * Applied on every /api/v1/ai route after requireAuth. Usage is recorded
 * AFTER each successful AI call (see ai.controller.ts), so the check here
 * compares the current month's total against the configured budget.
 */
export async function aiBudget(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [row] = await AiUsage.aggregate<{ total: number }>([
      {
        // NOTE: aggregate does NOT cast — req.user.id is a string,
        // the stored userId is an ObjectId, so cast explicitly here
        $match: {
          userId: new Types.ObjectId(req.user!.id),
          createdAt: { $gte: monthStart },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
        },
      },
    ]);

    const used = row?.total ?? 0;
    if (used >= env.AI_MONTHLY_TOKEN_BUDGET_PER_USER) {
      next(
        new AppError(
          429,
          'AI_BUDGET_EXCEEDED',
          `Monthly AI token budget of ${env.AI_MONTHLY_TOKEN_BUDGET_PER_USER} reached — resets at the start of next month`
        )
      );
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
