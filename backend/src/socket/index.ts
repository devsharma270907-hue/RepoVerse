import { Server as HttpServer } from 'http';
import { Server as IOServer, Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../modules/users/user.model';

/**
 * Socket.io server (PRD §9 / §5) — real-time analysis progress.
 *
 * Security model:
 *  - JWT access token verified at handshake (`auth.token`); no anonymous
 *    sockets — invalid/expired tokens are rejected before `connection`.
 *  - Every authenticated socket auto-joins `user:<id>` — a server-side-only
 *    room scoped to ONE user. Progress events are emitted only to that
 *    room, so a client physically cannot receive another user's events
 *    and no client-claimable rooms exist.
 */

let io: IOServer | null = null;

export interface AnalysisUpdateEvent {
  analysisId: string;
  repoId: string;
  status: string;
  progress: number;
  error?: { code: string; message: string };
  summary?: unknown;
}

export function initSocketServer(httpServer: HttpServer): IOServer {
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());

  io = new IOServer(httpServer, {
    cors: { origin: origins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return next(new Error('Authentication required'));
      }
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('_id').lean();
      if (!user) return next(new Error('Invalid token'));

      socket.data.userId = String(user._id);
      socket.join(`user:${socket.data.userId}`);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`Socket connected user=${socket.data.userId}`);
  });

  logger.info('Socket.io initialized');
  return io;
}

/** Current io instance, or null when sockets are not initialized (tests). */
export function getIo(): IOServer | null {
  return io;
}

/**
 * Emits an analysis progress update to the owning user's room.
 * Safe no-op when sockets are not initialized — HTTP polling keeps working.
 */
export function publishAnalysisUpdate(
  userId: unknown,
  event: AnalysisUpdateEvent
): void {
  if (!io) return;
  io.to(`user:${String(userId)}`).emit('analysis:update', event);
}

export function closeSocketServer(): Promise<void> {
  if (!io) return Promise.resolve();
  const server = io;
  io = null;
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
