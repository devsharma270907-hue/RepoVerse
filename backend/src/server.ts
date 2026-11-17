import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { logger } from './utils/logger';
import { createServer } from 'http';
import { initSocketServer, closeSocketServer } from './socket';
import { startStaleSweepCron, stopStaleSweepCron } from './jobs/staleAnalyses';
import { initSentry, flushSentry, captureException } from './config/sentry';
import app from './app';

/**
 * Entry point (blueprint Section 2): DB connect → socket.io + cron → listen.
 * Graceful shutdown on SIGINT/SIGTERM for clean deploys.
 */
async function bootstrap(): Promise<void> {
  initSentry();
  await connectDB();

  const httpServer = createServer(app);
  initSocketServer(httpServer);
  startStaleSweepCron();

  const server = httpServer.listen(env.PORT, () => {
    logger.info(
      `🚀 RepoVerse backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully…`);
    stopStaleSweepCron();
    await closeSocketServer();
    server.close(async () => {
      await flushSentry();
      await disconnectDB();
      process.exit(0);
    });
    // Force-exit safety valve if connections hang
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error(
      'Unhandled promise rejection',
      reason instanceof Error ? reason : new Error(String(reason))
    );
    captureException(reason);
  });
}

bootstrap().catch((err) => {
  logger.error(
    '❌ Fatal bootstrap error',
    err instanceof Error ? err : new Error(String(err))
  );
  process.exit(1);
});
