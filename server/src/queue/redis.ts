import { Redis } from 'ioredis';
import { config } from '../config/env.js';

/**
 * BullMQ workers and pub/sub subscribers need `maxRetriesPerRequest: null`, so blocking
 * commands wait out Redis restarts. Producers keep the default so an API
 * request fails fast instead of hanging when Redis is down.
 */
export function createRedisConnection(name: string, { blocking = false } = {}): Redis {
  return new Redis(config.redis.url, {
    connectionName: name,
    ...(blocking && { maxRetriesPerRequest: null }),
  });
}
