import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/** Position after the last row of a page, ordered by (created_at DESC, id DESC). */
export interface PageCursor {
  createdAt: string; // ISO-8601 with microseconds, so no rows are skipped or repeated
  id: string;
}

const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string): PageCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor');
  }
}
