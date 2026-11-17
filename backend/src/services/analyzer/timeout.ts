import { AppError } from '../../utils/appError';
import { env } from '../../config/env';

/**
 * Hard wall-clock timeout for the whole analysis pipeline (PRD §10.1).
 * A huge/slow repo is failed with ANALYSIS_TIMEOUT, never half-processed.
 */
export function withAnalysisTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AppError(
          504,
          'ANALYSIS_TIMEOUT',
          `Analysis exceeded the ${env.ANALYSIS_TIMEOUT_SECONDS}s time limit`
        )
      );
    }, env.ANALYSIS_TIMEOUT_SECONDS * 1000);
    timer.unref();
  });

  return Promise.race([promise, timeout]).finally(() => timer?.unref());
}
