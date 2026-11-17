import mongoose from 'mongoose';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { noSqlSanitize } from './middleware/noSqlSanitize';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { env, isDev } from './config/env';
import { logger } from './utils/logger';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// ── Health & readiness (blueprint Section 4) ────────────────────────────
// Mounted BEFORE heavy middleware so a bad config never blocks them.
// GET /health — liveness: process is up (no DB call)
app.get('/health', (_req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

// GET /ready — readiness: dependencies usable (DB connected)
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  if (ready) {
    res.status(200).json({ success: true, data: { status: 'ready' } });
    return;
  }
  res.status(503).json({
    success: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Database not connected' },
  });
});

// ── Middleware stack (order matters — blueprint Section 4) ──────────────

// 1. Security headers
app.use(helmet());

// 2. CORS — explicit origin list only, never '*' with credentials
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// 3. Body parsing — small payload limit prevents size attacks
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// 4. Cookie parser (refresh-token cookie)
app.use(cookieParser());

// 5. NoSQL injection prevention — strips $ and . keys from body/query/params
app.use(noSqlSanitize);

// 6. HTTP request logging (dev only) — routed through winston
if (isDev) {
  app.use(
    morgan('dev', {
      stream: { write: (message: string) => logger.info(message.trim()) },
    })
  );
}

// 7. Global rate limit
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// 8. Strict auth-route rate limit
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_AUTH_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/auth', authLimiter);

// 9. Routes
app.use('/api/v1', routes);

// 10. Central error handler (always last)
app.use(errorHandler);

export default app;
