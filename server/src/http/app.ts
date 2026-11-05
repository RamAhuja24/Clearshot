import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.js';
import { createImagesRouter } from '../modules/images/imagesRouter.js';
import type { ImagesService } from '../modules/images/imagesService.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createUploadRateLimit } from './middleware/rateLimit.js';
import { createUploadMiddleware } from './middleware/upload.js';
import type { SseHub } from './sseHub.js';

export type HealthCheck = () => Promise<unknown>;

export interface AppDeps {
  imagesService: ImagesService;
  sseHub: SseHub;
  logger: Logger;
  healthChecks: Record<string, HealthCheck>;
  clientOrigins: readonly string[];
  uploadMaxBytes: number;
  uploadRateLimitPerMinute: number;
  presignTtlSeconds: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/events' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: [...deps.clientOrigins], exposedHeaders: ['Location', 'X-Request-Id'] }));
  app.use(express.json({ limit: '16kb' }));

  const api = Router();
  api.get('/health', async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(deps.healthChecks).map(async ([name, check]) => {
        try {
          await check();
          return [name, 'ok'] as const;
        } catch {
          return [name, 'unavailable'] as const;
        }
      }),
    );
    const healthy = entries.every(([, status]) => status === 'ok');
    res
      .status(healthy ? 200 : 503)
      .json({ status: healthy ? 'ok' : 'degraded', checks: Object.fromEntries(entries) });
  });
  api.get('/events', (req, res) => deps.sseHub.connect(req, res));
  api.use(
    '/images',
    createImagesRouter({
      service: deps.imagesService,
      upload: createUploadMiddleware(deps.uploadMaxBytes),
      uploadRateLimit: createUploadRateLimit(deps.uploadRateLimitPerMinute),
      presignTtlSeconds: deps.presignTtlSeconds,
    }),
  );

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
