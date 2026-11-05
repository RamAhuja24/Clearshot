import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../../lib/errors.js';

const formatMegabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Accepts exactly one file in the `file` field, buffered in memory under a hard
 * size cap. Format is decided later from the bytes, never from the declared MIME type.
 */
export function createUploadMiddleware(maxBytes: number): RequestHandler {
  const parseSingleFile = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes,
      files: 1,
      fields: 2,
      parts: 3,
      fieldNameSize: 64,
      headerPairs: 50,
    },
  }).single('file');

  return (req, res, next) => {
    parseSingleFile(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              413,
              'FILE_TOO_LARGE',
              `Images must be ${formatMegabytes(maxBytes)} or smaller.`,
            ),
          );
        }
        return next(new AppError(400, 'BAD_REQUEST', `Invalid upload: ${error.message}.`));
      }
      next(error);
    });
  };
}
