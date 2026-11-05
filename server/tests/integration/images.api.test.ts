import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImageDto } from '../../src/modules/images/dto.js';
import { IMAGE_QUEUE_NAME } from '../../src/queue/imageQueue.js';
import { nearDuplicateOf, readFixture } from '../helpers/fixtures.js';
import {
  createTestContext,
  TEST_UPLOAD_MAX_BYTES,
  type TestContext,
} from '../helpers/testContext.js';

// Requires the docker-compose services (Postgres, Redis, object storage).
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  await ctx.reset();
});

async function upload(buffer: Buffer, filename: string) {
  return request(ctx.app).post('/api/images').attach('file', buffer, filename);
}

/** Uploads, runs the processor the way the worker would, and returns the final resource. */
async function uploadAndProcess(buffer: Buffer, filename: string): Promise<ImageDto> {
  const response = await upload(buffer, filename);
  expect(response.status).toBe(202);
  await ctx.processor.process(response.body.id);
  return (await request(ctx.app).get(`/api/images/${response.body.id}`)).body as ImageDto;
}

describe('POST /api/images', () => {
  it('stores the original, queues processing and answers 202', async () => {
    const response = await upload(await readFixture('portrait-koch.jpg'), 'koch.jpg');

    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(`/api/images/${response.body.id}`);
    expect(response.body).toMatchObject({
      originalFilename: 'koch.jpg',
      format: 'jpeg',
      status: 'processing',
      rejectionReasons: [],
    });
    const job = await ctx.queue.getJob(response.body.id);
    expect(job?.queueName).toBe(IMAGE_QUEUE_NAME);
  });

  it('decides the format from the bytes, not the filename', async () => {
    const gif = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#abc' },
    })
      .gif()
      .toBuffer();
    const disguised = await upload(gif, 'photo.jpg');
    expect(disguised.status).toBe(415);
    expect(disguised.body.error.code).toBe('UNSUPPORTED_FORMAT');

    const text = await upload(Buffer.from('not an image'), 'photo.png');
    expect(text.status).toBe(415);
  });

  it('rejects missing and oversized files', async () => {
    const missing = await request(ctx.app).post('/api/images');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('FILE_REQUIRED');

    const tooLarge = Buffer.alloc(TEST_UPLOAD_MAX_BYTES + 1);
    tooLarge.set([0xff, 0xd8, 0xff]);
    const response = await upload(tooLarge, 'huge.jpg');
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('processing pipeline', () => {
  it('accepts a good portrait and serves its thumbnail through a presigned redirect', async () => {
    const image = await uploadAndProcess(await readFixture('portrait-koch.jpg'), 'koch.jpg');

    expect(image.status).toBe('accepted');
    expect(image.metrics.faceCount).toBe(1);
    expect(image.urls.thumbnail).toBeTruthy();
    expect(ctx.events).toContainEqual({
      type: 'image.updated',
      image: expect.objectContaining({ id: image.id, status: 'accepted' }),
    });

    const redirect = await request(ctx.app).get(image.urls.thumbnail!);
    expect(redirect.status).toBe(302);
    const thumbnail = await fetch(redirect.headers.location!);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
  });

  it('converts HEIC uploads to JPEG', async () => {
    const image = await uploadAndProcess(await readFixture('portrait-hansen.heic'), 'hansen.heic');

    expect(image).toMatchObject({ format: 'heic', status: 'accepted', width: 999, height: 1332 });
    const redirect = await request(ctx.app).get(image.urls.converted!);
    const converted = Buffer.from(await (await fetch(redirect.headers.location!)).arrayBuffer());
    expect((await sharp(converted).metadata()).format).toBe('jpeg');
  });

  it.each([
    ['group-artemis-crew.jpg', 'MULTIPLE_FACES'],
    ['landscape-grand-canyon.jpg', 'NO_FACE'],
  ])('rejects %s with %s', async (fixture, code) => {
    const image = await uploadAndProcess(await readFixture(fixture), fixture);
    expect(image.status).toBe('rejected');
    expect(image.rejectionReasons.map((reason) => reason.code)).toContain(code);
  });

  it('rejects blurry and low-resolution photos', async () => {
    const original = await readFixture('portrait-glover.jpg');
    const blurry = await uploadAndProcess(
      await sharp(original).blur(4).jpeg().toBuffer(),
      'blurry.jpg',
    );
    expect(blurry.rejectionReasons.map((r) => r.code)).toEqual(['BLURRY']);

    const small = await uploadAndProcess(
      await sharp(original).flop().resize(320).jpeg().toBuffer(),
      'small.jpg',
    );
    expect(small.rejectionReasons.map((r) => r.code)).toContain('RESOLUTION_TOO_LOW');
  });

  it('rejects exact and near duplicates of accepted images', async () => {
    const original = await readFixture('portrait-koch.jpg');
    expect((await uploadAndProcess(original, 'first.jpg')).status).toBe('accepted');

    const exact = await uploadAndProcess(original, 'again.jpg');
    expect(exact.rejectionReasons.map((r) => r.code)).toEqual(['DUPLICATE']);

    const near = await uploadAndProcess(await nearDuplicateOf('portrait-koch.jpg'), 'edited.jpg');
    expect(near.rejectionReasons.map((r) => r.code)).toEqual(['TOO_SIMILAR']);
  });

  it('accepts only the earliest of look-alikes processed in parallel', async () => {
    const first = await upload(await readFixture('portrait-wiseman.jpg'), 'first.jpg');
    const second = await upload(await nearDuplicateOf('portrait-wiseman.jpg'), 'second.jpg');

    // Start the newer one first: ordering must come from upload time, not finish time.
    await Promise.all([
      ctx.processor.process(second.body.id),
      ctx.processor.process(first.body.id),
    ]);

    const statuses = await Promise.all(
      [first, second].map(
        async (r) => (await request(ctx.app).get(`/api/images/${r.body.id}`)).body.status,
      ),
    );
    expect(statuses).toEqual(['accepted', 'rejected']);
  });

  it('marks undecodable files as rejected instead of failing the job', async () => {
    const truncated = (await readFixture('portrait-koch.jpg')).subarray(0, 4_000);
    const image = await uploadAndProcess(truncated, 'broken.jpg');
    expect(image.status).toBe('rejected');
    expect(image.rejectionReasons.map((r) => r.code)).toEqual(['UNREADABLE_IMAGE']);
  });
});

describe('reading and deleting', () => {
  it('lists by status with keyset pagination and reports a summary', async () => {
    await uploadAndProcess(await readFixture('portrait-koch.jpg'), 'a.jpg');
    await uploadAndProcess(await readFixture('portrait-hansen.jpg'), 'b.jpg');
    await uploadAndProcess(await readFixture('landscape-grand-canyon.jpg'), 'c.jpg');

    const page1 = await request(ctx.app).get('/api/images?status=accepted&limit=1');
    expect(page1.body.data.map((i: ImageDto) => i.originalFilename)).toEqual(['b.jpg']);
    const page2 = await request(ctx.app).get(
      `/api/images?status=accepted&limit=1&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.data.map((i: ImageDto) => i.originalFilename)).toEqual(['a.jpg']);
    expect(page2.body.nextCursor).toBeNull();

    const rejected = await request(ctx.app).get('/api/images?status=rejected,failed');
    expect(rejected.body.data).toHaveLength(1);

    const summary = await request(ctx.app).get('/api/images/summary');
    expect(summary.body).toEqual({ processing: 0, accepted: 2, rejected: 1, failed: 0, total: 3 });
  });

  it('validates query parameters and ids', async () => {
    expect((await request(ctx.app).get('/api/images?status=bogus')).status).toBe(400);
    expect((await request(ctx.app).get('/api/images?limit=1000')).status).toBe(400);
    expect((await request(ctx.app).get('/api/images/not-a-uuid')).status).toBe(400);
    expect(
      (await request(ctx.app).get('/api/images/2f1d6c3e-4b5a-4c1d-9e8f-0a1b2c3d4e5f')).status,
    ).toBe(404);
  });

  it('deletes the image, its objects and announces it', async () => {
    const image = await uploadAndProcess(await readFixture('portrait-koch.jpg'), 'koch.jpg');
    const thumbnailUrl = (await request(ctx.app).get(image.urls.thumbnail!)).headers.location!;

    expect((await request(ctx.app).delete(`/api/images/${image.id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/images/${image.id}`)).status).toBe(404);
    expect((await fetch(thumbnailUrl)).status).toBe(404);
    expect(ctx.events).toContainEqual({ type: 'image.deleted', id: image.id });
    expect((await request(ctx.app).delete(`/api/images/${image.id}`)).status).toBe(404);
  });
});
