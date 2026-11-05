import type { Redis } from 'ioredis';
import type { ImageDto } from '../modules/images/dto.js';

const CHANNEL = 'images:events';

export type ImageEvent =
  { type: 'image.updated'; image: ImageDto } | { type: 'image.deleted'; id: string };

export interface ImageEventPublisher {
  publish(event: ImageEvent): Promise<void>;
}

/** Worker and API processes publish over Redis, so events reach every API instance. */
export function createImageEventPublisher(redis: Redis): ImageEventPublisher {
  return {
    async publish(event) {
      await redis.publish(CHANNEL, JSON.stringify(event));
    },
  };
}

export async function subscribeToImageEvents(
  subscriber: Redis,
  onEvent: (event: ImageEvent) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      onEvent(JSON.parse(message) as ImageEvent);
    } catch (error) {
      onError(error);
    }
  });
  // Subscribing before the ready check finishes makes ioredis reject its own INFO
  // probe. Later reconnects resubscribe automatically.
  if (subscriber.status !== 'ready') {
    await new Promise<void>((resolve) => subscriber.once('ready', () => resolve()));
  }
  await subscriber.subscribe(CHANNEL);
}
