import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { CONTENT_VARIANTS, IMAGE_STATUSES } from './domain.js';

export const imageIdParams = z.object({ id: z.uuid() });

/** `?status=rejected,failed` filters by any of the listed statuses. */
const statusList = z
  .string()
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(z.enum(IMAGE_STATUSES)).min(1));

export const listImagesQuery = z.object({
  status: statusList.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(512).optional(),
});
export type ListImagesQuery = z.infer<typeof listImagesQuery>;

export const contentQuery = z.object({
  variant: z.enum(CONTENT_VARIANTS).default('thumbnail'),
});

/** Parses untrusted request input, turning schema failures into a 400 response. */
export function parseRequest<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', issues);
  }
  return result.data;
}
