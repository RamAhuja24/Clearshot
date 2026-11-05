import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { config } from '../config/env.js';

export const IMAGE_QUEUE_NAME = 'image-processing';

export interface ProcessImageJobData {
  imageId: string;
}

export type ImageQueue = Queue<ProcessImageJobData>;

export function createImageQueue(connection: Redis): ImageQueue {
  return new Queue<ProcessImageJobData>(IMAGE_QUEUE_NAME, {
    connection,
    prefix: config.redis.queuePrefix,
    defaultJobOptions: {
      attempts: config.worker.jobAttempts,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
}

/** The job id equals the image id, so a duplicate enqueue is a no-op. */
export async function enqueueImageProcessing(queue: ImageQueue, imageId: string): Promise<void> {
  await queue.add('process-image', { imageId }, { jobId: imageId });
}
