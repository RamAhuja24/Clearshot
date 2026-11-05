import { Router, type RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import type { ImagesService } from './imagesService.js';
import { contentQuery, imageIdParams, listImagesQuery, parseRequest } from './schemas.js';

export interface ImagesRouterDeps {
  service: ImagesService;
  upload: RequestHandler;
  uploadRateLimit: RequestHandler;
  presignTtlSeconds: number;
}

// Express 5 forwards rejected promises to the error handler, so handlers stay thin.
export function createImagesRouter({
  service,
  upload,
  uploadRateLimit,
  presignTtlSeconds,
}: ImagesRouterDeps): Router {
  const router = Router();

  router.post('/', uploadRateLimit, upload, async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'FILE_REQUIRED', 'Attach an image in the "file" form field.');
    }
    const image = await service.upload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
    });
    res.status(202).location(`/api/images/${image.id}`).json(image);
  });

  router.get('/', async (req, res) => {
    res.json(await service.list(parseRequest(listImagesQuery, req.query)));
  });

  router.get('/summary', async (_req, res) => {
    res.json(await service.summary());
  });

  router.get('/:id', async (req, res) => {
    const { id } = parseRequest(imageIdParams, req.params);
    res.json(await service.get(id));
  });

  router.get('/:id/content', async (req, res) => {
    const { id } = parseRequest(imageIdParams, req.params);
    const { variant } = parseRequest(contentQuery, req.query);
    const url = await service.contentUrl(id, variant);
    // Cache the redirect for less time than the signed URL stays valid.
    res.set('Cache-Control', `private, max-age=${Math.max(0, presignTtlSeconds - 60)}`);
    res.redirect(302, url);
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parseRequest(imageIdParams, req.params);
    await service.remove(id);
    res.status(204).end();
  });

  return router;
}
