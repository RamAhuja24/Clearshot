import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { FaceDetector } from '../../src/processing/analyzers/faceDetector.js';
import {
  differenceHash,
  differenceHashFromPixels,
  hammingDistance,
} from '../../src/processing/analyzers/perceptualHash.js';
import { laplacianVariance, measureSharpness } from '../../src/processing/analyzers/sharpness.js';
import { decodeToRaster, type Raster } from '../../src/processing/raster.js';
import { nearDuplicateOf, readFixture } from '../helpers/fixtures.js';

const decode = (buffer: Buffer, format: 'jpeg' | 'png' | 'heic' = 'jpeg') =>
  decodeToRaster(buffer, format, { maxPixels: 50_000_000 });

describe('perceptual hash', () => {
  it('sets a bit wherever a pixel is brighter than its right neighbour', () => {
    // Every row descends left to right, so every comparison is "brighter": all 64 bits set.
    const descending = Uint8Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(differenceHashFromPixels(descending)).toBe((1n << 64n) - 1n);
    expect(differenceHashFromPixels(new Uint8Array(72))).toBe(0n);
  });

  it('counts differing bits, including across the signed 64-bit boundary', () => {
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2);
    const hash = (1n << 63n) | 5n;
    const storedSigned = BigInt.asIntN(64, hash);
    expect(storedSigned).toBeLessThan(0n);
    expect(hammingDistance(hash, storedSigned)).toBe(0);
  });

  it('is stable across re-encoding but differs between people', async () => {
    const koch = await differenceHash(await decode(await readFixture('portrait-koch.jpg')));
    const kochCopy = await differenceHash(await decode(await nearDuplicateOf('portrait-koch.jpg')));
    const hansen = await differenceHash(await decode(await readFixture('portrait-hansen.jpg')));
    expect(hammingDistance(koch, kochCopy)).toBeLessThanOrEqual(8);
    expect(hammingDistance(koch, hansen)).toBeGreaterThan(16);
  });
});

describe('sharpness', () => {
  it('is zero for a flat image and high for hard edges', () => {
    const flat = new Uint8Array(16 * 16).fill(128);
    expect(laplacianVariance(flat, 16, 16)).toBe(0);
    const checkerboard = Uint8Array.from({ length: 16 * 16 }, (_, i) =>
      ((i % 16) + Math.floor(i / 16)) % 2 === 0 ? 0 : 255,
    );
    expect(laplacianVariance(checkerboard, 16, 16)).toBeGreaterThan(10_000);
  });

  it('drops sharply when a photo is blurred', async () => {
    const original = await readFixture('portrait-koch.jpg');
    const sharp_ = await measureSharpness(await decode(original));
    const blurred = await measureSharpness(await decode(await sharp(original).blur(3).toBuffer()));
    expect(sharp_).toBeGreaterThan(300);
    expect(blurred).toBeLessThan(100);
  });
});

describe('decodeToRaster', () => {
  it('decodes HEIC through libheif', async () => {
    const raster = await decode(await readFixture('portrait-hansen.heic'), 'heic');
    expect(raster).toMatchObject({ width: 999, height: 1332, channels: 3 });
  });

  it('applies EXIF orientation', async () => {
    const rotated = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#888' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(await decode(rotated)).toMatchObject({ width: 400, height: 600 });
  });

  it('rejects corrupt files and images over the pixel limit', async () => {
    const truncated = (await readFixture('portrait-koch.jpg')).subarray(0, 2_000);
    await expect(decode(truncated)).rejects.toThrow('could not be decoded');
    const big = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    await expect(decodeToRaster(big, 'png', { maxPixels: 1_000_000 })).rejects.toThrow('megapixel');
  });
});

describe('FaceDetector', () => {
  let detector: FaceDetector;
  const facesIn = async (raster: Raster) => (await detector.detect(raster, 0.7)).length;

  beforeAll(async () => {
    detector = await FaceDetector.load();
  });

  it('counts faces in real photos', async () => {
    expect(await facesIn(await decode(await readFixture('portrait-koch.jpg')))).toBe(1);
    expect(await facesIn(await decode(await readFixture('group-artemis-crew.jpg')))).toBe(4);
    expect(await facesIn(await decode(await readFixture('landscape-grand-canyon.jpg')))).toBe(0);
  });

  it('returns boxes in image pixels', async () => {
    const raster = await decode(await readFixture('portrait-koch.jpg'));
    const [face] = await detector.detect(raster, 0.7);
    expect(face!.left + face!.width).toBeLessThanOrEqual(raster.width);
    expect(face!.top + face!.height).toBeLessThanOrEqual(raster.height);
    expect((face!.width * face!.height) / (raster.width * raster.height)).toBeGreaterThan(0.1);
  });
});
