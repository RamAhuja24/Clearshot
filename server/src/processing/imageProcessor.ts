import { setTimeout } from 'node:timers/promises';
import type { ValidationConfig } from '../config/env.js';
import type { Logger } from '../lib/logger.js';
import type { ImageRecord } from '../modules/images/domain.js';
import { toImageDto } from '../modules/images/dto.js';
import type { ImageRepository, ProcessingResult } from '../modules/images/imageRepository.js';
import type { ImageEventPublisher } from '../queue/imageEvents.js';
import { objectKeys } from '../storage/objectKeys.js';
import type { ObjectStorage } from '../storage/objectStorage.js';
import type { FaceDetector } from './analyzers/faceDetector.js';
import { differenceHash } from './analyzers/perceptualHash.js';
import { measureSharpness } from './analyzers/sharpness.js';
import { decodeToRaster, rasterToSharp, UnreadableImageError, type Raster } from './raster.js';
import { evaluateRules, type ImageAnalysis } from './rules.js';

const THUMBNAIL_MAX_SIDE = 480;
/** How often, and for how long, to wait for an older look-alike upload to finish. */
const PREDECESSOR_POLL_MS = 150;
const PREDECESSOR_MAX_WAIT_MS = 15_000;
const PREDECESSOR_STALE_AFTER_SECONDS = 120;
/** Face crops smaller than this are too small for a stable sharpness score. */
const MIN_SHARPNESS_REGION_PX = 48;
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

export interface ImageProcessorDeps {
  repo: ImageRepository;
  storage: ObjectStorage;
  faceDetector: FaceDetector;
  events: ImageEventPublisher;
  validation: ValidationConfig;
  logger: Logger;
}

type Derivatives = Pick<ProcessingResult, 'thumbnailKey' | 'convertedKey'>;

/**
 * Validates one uploaded image end to end. It is safe to re-run: derived objects
 * are overwritten in place, and only an image still in `processing` gets finalised.
 */
export function createImageProcessor(deps: ImageProcessorDeps) {
  const { repo, storage, faceDetector, events, validation, logger } = deps;

  async function storeDerivatives(image: ImageRecord, raster: Raster): Promise<Derivatives> {
    const thumbnailKey = objectKeys.thumbnail(image.id);
    const thumbnail = await rasterToSharp(raster)
      .resize(THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await storage.put(thumbnailKey, thumbnail, {
      contentType: 'image/webp',
      cacheControl: IMMUTABLE_CACHE,
    });

    if (image.format !== 'heic') return { thumbnailKey, convertedKey: null };

    // HEIC is converted to a full-resolution JPEG that every browser and tool can open.
    const convertedKey = objectKeys.converted(image.id);
    const jpeg = await rasterToSharp(raster).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    await storage.put(convertedKey, jpeg, {
      contentType: 'image/jpeg',
      cacheControl: IMMUTABLE_CACHE,
    });
    return { thumbnailKey, convertedKey };
  }

  async function analyse(
    image: ImageRecord,
    raster: Raster,
  ): Promise<Omit<ImageAnalysis, 'similarity'>> {
    const faces = await faceDetector.detect(raster, validation.faceMinConfidence);
    const [largestFace] = faces;
    // With exactly one face, judge sharpness on the face itself, so a deliberately
    // blurred background (portrait mode) does not count against the photo.
    const sharpnessRegion =
      faces.length === 1 &&
      largestFace &&
      Math.min(largestFace.width, largestFace.height) >= MIN_SHARPNESS_REGION_PX
        ? largestFace
        : undefined;

    const sharpness = await measureSharpness(raster, sharpnessRegion);

    return {
      sizeBytes: image.size_bytes,
      width: raster.width,
      height: raster.height,
      sharpness,
      faceCount: faces.length,
      largestFaceAreaRatio: largestFace
        ? (largestFace.width * largestFace.height) / (raster.width * raster.height)
        : null,
    };
  }

  /**
   * Decides accepted or rejected. The duplicate check and the status write run in one
   * transaction under an advisory lock, so two look-alikes processed in parallel can
   * never both be accepted. When look-alikes arrive together, the earliest upload wins:
   * an image that would be accepted first waits for older look-alikes still in progress.
   */
  async function finalize(
    image: ImageRecord,
    phash: bigint,
    analysis: Omit<ImageAnalysis, 'similarity'>,
    derivatives: Derivatives,
  ) {
    const waitUntil = Date.now() + PREDECESSOR_MAX_WAIT_MS;
    for (;;) {
      const outcome = await repo.transaction(async (tx) => {
        await tx.acquireSimilarityLock();
        const match = await tx.findSimilarAccepted({
          excludeId: image.id,
          sha256: image.sha256,
          phash,
          maxDistance: validation.similarityMaxDistance,
        });
        const reasons = evaluateRules(
          {
            ...analysis,
            similarity: match
              ? { imageId: match.id, distance: match.distance, exact: match.exact }
              : null,
          },
          validation,
        );

        const mustWait =
          reasons.length === 0 &&
          Date.now() < waitUntil &&
          (await tx.hasPendingPredecessor({
            id: image.id,
            sha256: image.sha256,
            phash,
            maxDistance: validation.similarityMaxDistance,
            staleAfterSeconds: PREDECESSOR_STALE_AFTER_SECONDS,
          }));
        if (mustWait) return null;

        const status = reasons.length === 0 ? 'accepted' : 'rejected';
        const saved = await tx.completeProcessing(image.id, {
          status,
          width: analysis.width,
          height: analysis.height,
          phash,
          blurScore: analysis.sharpness,
          faceCount: analysis.faceCount,
          faceAreaRatio: analysis.largestFaceAreaRatio,
          similarToId: match?.id ?? null,
          ...derivatives,
          reasons,
        });
        return { saved, status, reasons };
      });

      if (outcome) return outcome;
      await setTimeout(PREDECESSOR_POLL_MS);
    }
  }

  async function publishUpdate(imageId: string): Promise<void> {
    try {
      const found = await repo.findWithReasons(imageId);
      if (found) {
        await events.publish({
          type: 'image.updated',
          image: toImageDto(found.image, found.reasons),
        });
      }
    } catch (error) {
      // Clients re-sync on reconnect, so a lost event is not worth failing the job.
      logger.warn({ err: error, imageId }, 'Failed to publish image update');
    }
  }

  async function processImage(imageId: string): Promise<void> {
    const log = logger.child({ imageId });
    const image = await repo.findById(imageId);
    if (!image) {
      log.info('Image was deleted before processing; skipping');
      return;
    }
    if (image.status !== 'processing') {
      log.info({ status: image.status }, 'Image already processed; skipping');
      return;
    }

    const startedAt = performance.now();
    const original = await storage.get(image.original_key);

    let raster: Raster;
    try {
      raster = await decodeToRaster(original, image.format, { maxPixels: validation.maxPixels });
    } catch (error) {
      if (!(error instanceof UnreadableImageError)) throw error;
      await repo.completeProcessing(image.id, {
        status: 'rejected',
        width: null,
        height: null,
        phash: null,
        blurScore: null,
        faceCount: null,
        faceAreaRatio: null,
        similarToId: null,
        thumbnailKey: null,
        convertedKey: null,
        reasons: [{ code: 'UNREADABLE_IMAGE', message: error.message }],
      });
      log.info('Rejected unreadable image');
      await publishUpdate(image.id);
      return;
    }

    // Publish the hash first, so newer look-alike uploads know to wait for this one.
    const phash = await differenceHash(raster);
    await repo.saveHash(image.id, phash);

    const derivatives = await storeDerivatives(image, raster);
    const analysis = await analyse(image, raster);
    const outcome = await finalize(image, phash, analysis, derivatives);

    if (!outcome.saved) {
      // Deleted while processing: remove the derivatives just written.
      const keys = [derivatives.thumbnailKey, derivatives.convertedKey].filter(
        (key): key is string => key !== null,
      );
      await storage.delete(keys).catch(() => undefined);
      log.info('Image was deleted during processing; discarded results');
      return;
    }

    log.info(
      {
        status: outcome.status,
        reasons: outcome.reasons.map((reason) => reason.code),
        sharpness: Math.round(analysis.sharpness),
        faces: analysis.faceCount,
        ms: Math.round(performance.now() - startedAt),
      },
      'Image processed',
    );
    await publishUpdate(image.id);
  }

  /** Records a permanent failure (retries exhausted) and notifies clients. */
  async function markFailed(imageId: string): Promise<void> {
    const changed = await repo.markFailed(
      imageId,
      'We could not process this image. Please try uploading it again.',
    );
    if (changed) await publishUpdate(imageId);
  }

  return { process: processImage, markFailed };
}

export type ImageProcessor = ReturnType<typeof createImageProcessor>;
