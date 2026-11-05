import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

/** Every error leaves the API in one shape; internals are logged, never returned. */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof AppError) {
    if (error.status >= 500) req.log.error({ err: error }, error.message);
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
      },
    });
    return;
  }

  // Malformed JSON bodies surface as body-parser errors carrying a 4xx status.
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request.' } });
    return;
  }

  req.log.error({ err: error }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
};
