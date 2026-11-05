import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { detectImageFormat, MIME_TYPE_BY_FORMAT } from '../../lib/fileType.js';
import type { Logger } from '../../lib/logger.js';
import { decodeMultipartFilename, sanitizeFilename } from '../../lib/sanitize.js';
import type { ImageEventPublisher } from '../../queue/imageEvents.js';
import { enqueueImageProcessing, type ImageQueue } from '../../queue/imageQueue.js';
import { objectKeys } from '../../storage/objectKeys.js';
import type { ObjectStorage } from '../../storage/objectStorage.js';
import type { ContentVariant, ImageRecord, ImageStatus } from './domain.js';
import { toImageDto, type ImageDto } from './dto.js';
import type { ImageRepository } from './imageRepository.js';
import { decodeCursor, encodeCursor } from './pagination.js';
import type { ListImagesQuery } from './schemas.js';

export interface ImagesServiceDeps {
  repo: ImageRepository;
  storage: ObjectStorage;
  queue: ImageQueue;
  events: ImageEventPublisher;
  logger: Logger;
  presignTtlSeconds: number;
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
}

export interface ImagePage {
  data: ImageDto[];
  nextCursor: string | null;
}

export type ImageSummary = Record<ImageStatus, number> & { total: number };

export function createImagesService(deps: ImagesServiceDeps) {
  const { repo, storage, queue, events, logger, presignTtlSeconds } = deps;

  return {
    /**
     * Stores the original and schedules validation. The heavy work happens in the
     * worker, so the request returns as soon as the job is queued.
     */
    async upload({ buffer, originalName }: UploadInput): Promise<ImageDto> {
      const format = detectImageFormat(buffer);
      if (!format) {
        throw new AppError(
          415,
          'UNSUPPORTED_FORMAT',
          'Only JPEG, PNG and HEIC images are supported.',
        );
      }

      const id = randomUUID();
      const originalKey = objectKeys.original(id, format);
      const mimeType = MIME_TYPE_BY_FORMAT[format];
      await storage.put(originalKey, buffer, { contentType: mimeType });

      let image: ImageRecord;
      try {
        image = await repo.insert({
          id,
          original_filename: sanitizeFilename(decodeMultipartFilename(originalName)),
          format,
          mime_type: mimeType,
          size_bytes: buffer.length,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          original_key: originalKey,
        });
      } catch (error) {
        await storage.delete([originalKey]).catch((cleanupError: unknown) => {
          logger.warn({ err: cleanupError, key: originalKey }, 'Failed to remove orphaned upload');
        });
        throw error;
      }

      try {
        await enqueueImageProcessing(queue, id);
      } catch (error) {
        logger.error({ err: error, imageId: id }, 'Failed to enqueue image processing');
        await repo.markFailed(id, 'Processing could not be scheduled.');
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Image processing is temporarily unavailable. Please try again.',
        );
      }

      return toImageDto(image, []);
    },

    async get(id: string): Promise<ImageDto> {
      const found = await repo.findWithReasons(id);
      if (!found) throw AppError.notFound('Image');
      return toImageDto(found.image, found.reasons);
    },

    async list({ status, limit, cursor }: ListImagesQuery): Promise<ImagePage> {
      const page = await repo.list({
        limit,
        ...(status && { statuses: status }),
        ...(cursor && { cursor: decodeCursor(cursor) }),
      });
      return {
        data: page.items.map(({ image, reasons }) => toImageDto(image, reasons)),
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      };
    },

    async summary(): Promise<ImageSummary> {
      const counts = await repo.countByStatus();
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      return { ...counts, total };
    },

    /** Returns a short-lived presigned URL, so image bytes never flow through the API. */
    async contentUrl(id: string, variant: ContentVariant): Promise<string> {
      const image = await repo.findById(id);
      if (!image) throw AppError.notFound('Image');

      const key = {
        original: image.original_key,
        thumbnail: image.thumbnail_key,
        converted: image.converted_key,
      }[variant];
      if (!key) throw AppError.notFound(`The ${variant} variant of this image`);

      return storage.presignGet(key, {
        expiresInSeconds: presignTtlSeconds,
        contentDisposition:
          variant === 'thumbnail' ? 'inline' : attachmentDisposition(image, variant),
      });
    },

    async remove(id: string): Promise<void> {
      const deleted = await repo.deleteById(id);
      if (!deleted) throw AppError.notFound('Image');

      const keys = [deleted.original_key, deleted.thumbnail_key, deleted.converted_key].filter(
        (key): key is string => key !== null,
      );
      // The row is the source of truth; leftover objects are only wasted space.
      await storage.delete(keys).catch((error: unknown) => {
        logger.warn({ err: error, imageId: id, keys }, 'Failed to delete stored objects');
      });
      await events.publish({ type: 'image.deleted', id }).catch((error: unknown) => {
        logger.warn({ err: error, imageId: id }, 'Failed to publish delete event');
      });
    },
  };
}

export type ImagesService = ReturnType<typeof createImagesService>;

/** RFC 6266 header with an ASCII fallback plus the UTF-8 filename. */
function attachmentDisposition(image: ImageRecord, variant: 'original' | 'converted'): string {
  const name =
    variant === 'converted'
      ? image.original_filename.replace(/\.[^.]*$/, '') + '.jpg'
      : image.original_filename;
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
