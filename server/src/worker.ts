import { Worker } from 'bullmq';
import sharp from 'sharp';
import { config } from './config/env.js';
import { createDatabase } from './db/knex.js';
import { logger as rootLogger } from './lib/logger.js';
import { ImageRepository } from './modules/images/imageRepository.js';
import { FaceDetector } from './processing/analyzers/faceDetector.js';
import { createImageProcessor } from './processing/imageProcessor.js';
import { createImageEventPublisher } from './queue/imageEvents.js';
import { IMAGE_QUEUE_NAME, type ProcessImageJobData } from './queue/imageQueue.js';
import { createRedisConnection } from './queue/redis.js';
import { createS3Storage } from './storage/objectStorage.js';

// Each image is processed once, so libvips' operation cache would only hold memory.
sharp.cache(false);

const logger = rootLogger.child({ service: 'worker' });

const db = createDatabase();
const connection = createRedisConnection('worker', { blocking: true });
const publisher = createRedisConnection('worker-events');
const storage = createS3Storage(config.s3);

if (config.s3.autoCreateBucket) await storage.ensureBucket();
const faceDetector = await FaceDetector.load();

const processor = createImageProcessor({
  repo: new ImageRepository(db),
  storage,
  faceDetector,
  events: createImageEventPublisher(publisher),
  validation: config.validation,
  logger,
});

const worker = new Worker<ProcessImageJobData>(
  IMAGE_QUEUE_NAME,
  async (job) => {
    try {
      await processor.process(job.data.imageId);
    } catch (error) {
      // attemptsMade counts earlier attempts, so +1 includes this one.
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isFinalAttempt) await processor.markFailed(job.data.imageId);
      throw error;
    }
  },
  { connection, prefix: config.redis.queuePrefix, concurrency: config.worker.concurrency },
);

worker.on('failed', (job, error) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  logger.warn(
    { err: error, imageId: job.data.imageId, attempt: job.attemptsMade, attempts },
    'Image processing attempt failed',
  );
  // Jobs that stall (worker crash) fail without reaching the handler above.
  if (job.attemptsMade >= attempts) {
    processor.markFailed(job.data.imageId).catch((markError: unknown) => {
      logger.error({ err: markError, imageId: job.data.imageId }, 'Failed to mark image as failed');
    });
  }
});
worker.on('error', (error) => logger.error({ err: error }, 'Worker error'));

logger.info({ concurrency: config.worker.concurrency }, 'Worker ready');

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down worker; finishing active jobs');
  await worker.close();
  await Promise.allSettled([db.destroy(), publisher.quit()]);
  await connection.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
