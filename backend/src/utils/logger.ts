import winston from 'winston';
import { env } from '../config/env';

/**
 * Structured logger (blueprint Section 6 — Infrastructure).
 *
 * REDACTION RULE: never log passwords, access/refresh tokens, API keys,
 * GitHub PATs, or raw repo source code. Log identifiers, not content.
 */
export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  transports: [new winston.transports.Console()],
});
