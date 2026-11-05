import { config } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/knex.js';
import { createApp } from '../../src/http/app.js';
import { SseHub } from '../../src/http/sseHub.js';
import { logger } from '../../src/lib/logger.js';
import { ImageRepository } from '../../src/modules/images/imageRepository.js';
import { createImagesService } from '../../src/modules/images/imagesService.js';
import { FaceDetector } from '../../src/processing/analyzers/faceDetector.js';
import { createImageProcessor } from '../../src/processing/imageProcessor.js';
import type { ImageEvent, ImageEventPublisher } from '../../src/queue/imageEvents.js';
import { createImageQueue } from '../../src/queue/imageQueue.js';
import { createRedisConnection } from '../../src/queue/redis.js';
import { createS3Storage } from '../../src/storage/objectStorage.js';

export const TEST_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Wires the real app against the test database, a test queue prefix and a test bucket.
 * Jobs are not consumed by a worker; tests run the processor directly, so they are deterministic.
 */
export async function createTestContext() {
  const db = createDatabase();
  await db.migrate.latest();

  const redis = createRedisConnection('integration-tests');
  const queue = createImageQueue(redis);
  const storage = createS3Storage(config.s3);
  await storage.ensureBucket();

  const events: ImageEvent[] = [];
  const publisher: ImageEventPublisher = {
    publish: async (event) => {
      events.push(event);
    },
  };

  const repo = new ImageRepository(db);
  const imagesService = createImagesService({
    repo,
    storage,
    queue,
    events: publisher,
    logger,
    presignTtlSeconds: 300,
  });
  const sseHub = new SseHub();
  const app = createApp({
    imagesService,
    sseHub,
    logger,
    healthChecks: { database: () => db.raw('SELECT 1') },
    clientOrigins: ['http://localhost:5173'],
    uploadMaxBytes: TEST_UPLOAD_MAX_BYTES,
    uploadRateLimitPerMinute: 10_000,
    presignTtlSeconds: 300,
  });
  const processor = createImageProcessor({
    repo,
    storage,
    faceDetector: await FaceDetector.load(),
    events: publisher,
    validation: config.validation,
    logger,
  });

  return {
    app,
    db,
    queue,
    storage,
    events,
    processor,
    async reset() {
      await db.raw('TRUNCATE images CASCADE');
      await queue.obliterate({ force: true });
      events.length = 0;
    },
    async close() {
      sseHub.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
      await db.destroy();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
