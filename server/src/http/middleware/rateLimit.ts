import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../../lib/errors.js';

/**
 * Per-IP upload limit. The in-memory store suits one API instance; with several
 * instances, swap in a Redis store so the limit is shared.
 */
export function createUploadRateLimit(perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many uploads. Please wait a moment and retry.')),
  });
}
