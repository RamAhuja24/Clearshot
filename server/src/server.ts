import { config } from './config/env.js';
import { createDatabase } from './db/knex.js';
import { createApp } from './http/app.js';
import { SseHub } from './http/sseHub.js';
import { logger as rootLogger } from './lib/logger.js';
import { ImageRepository } from './modules/images/imageRepository.js';
import { createImagesService } from './modules/images/imagesService.js';
import { createImageEventPublisher, subscribeToImageEvents } from './queue/imageEvents.js';
import { createImageQueue } from './queue/imageQueue.js';
import { createRedisConnection } from './queue/redis.js';
import { createS3Storage } from './storage/objectStorage.js';

const logger = rootLogger.child({ service: 'api' });

const db = createDatabase();
const redis = createRedisConnection('api');
const subscriber = createRedisConnection('api-events', { blocking: true });
const storage = createS3Storage(config.s3);
const queue = createImageQueue(redis);
const sseHub = new SseHub();

if (config.s3.autoCreateBucket) await storage.ensureBucket();

// Worker updates arrive over Redis and are relayed to every connected browser.
await subscribeToImageEvents(
  subscriber,
  (event) => sseHub.broadcast(event.type, event),
  (error) => logger.warn({ err: error }, 'Ignoring malformed image event'),
);

const app = createApp({
  imagesService: createImagesService({
    repo: new ImageRepository(db),
    storage,
    queue,
    events: createImageEventPublisher(redis),
    logger,
    presignTtlSeconds: config.s3.presignTtlSeconds,
  }),
  sseHub,
  logger,
  healthChecks: {
    database: () => db.raw('SELECT 1'),
    redis: () => redis.ping(),
    storage: () => storage.ping(),
  },
  clientOrigins: config.api.clientOrigins,
  uploadMaxBytes: config.api.uploadMaxBytes,
  uploadRateLimitPerMinute: config.api.uploadRateLimitPerMinute,
  presignTtlSeconds: config.s3.presignTtlSeconds,
});

const server = app.listen(config.api.port, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'Failed to start API');
    process.exit(1);
  }
  logger.info(`API listening on http://localhost:${config.api.port}`);
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down API');

  sseHub.close(); // open event streams would otherwise keep the server alive
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([queue.close(), subscriber.quit(), db.destroy()]);
  await redis.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));
