import decodeHeic from 'heic-decode';
import sharp from 'sharp';
import type { ImageFormat } from '../lib/fileType.js';

/** The image cannot be decoded, so it is rejected rather than retried. */
export class UnreadableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableImageError';
  }
}

/**
 * Decoded pixels: 8-bit sRGB, alpha flattened, EXIF orientation applied.
 * The image is decoded once; every analysis and derivative reads from this.
 */
export interface Raster {
  data: Buffer;
  width: number;
  height: number;
  channels: 3;
}

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rasterToSharp(raster: Raster): sharp.Sharp {
  return sharp(raster.data, {
    raw: { width: raster.width, height: raster.height, channels: raster.channels },
  });
}

export async function decodeToRaster(
  buffer: Buffer,
  format: ImageFormat,
  { maxPixels }: { maxPixels: number },
): Promise<Raster> {
  const source =
    format === 'heic'
      ? await decodeHeicToSharp(buffer, maxPixels)
      : // failOn 'error' tolerates harmless encoder warnings but not real corruption.
        sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error' }).rotate();

  try {
    const { data, info } = await source
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Unexpected channel count ${info.channels}`);
    return { data, width: info.width, height: info.height, channels: 3 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UnreadableImageError(
      message.includes('pixel limit')
        ? `Image is larger than the ${Math.round(maxPixels / 1e6)} megapixel limit.`
        : 'The image file is corrupted or could not be decoded.',
    );
  }
}

/**
 * sharp's prebuilt binaries have no HEVC decoder, so HEIC goes through libheif
 * (WebAssembly). Dimensions are checked before decoding as a decompression-bomb guard.
 */
async function decodeHeicToSharp(buffer: Buffer, maxPixels: number): Promise<sharp.Sharp> {
  let images: Awaited<ReturnType<typeof decodeHeic.all>>;
  try {
    images = await decodeHeic.all({ buffer });
  } catch {
    throw new UnreadableImageError('The HEIC file is corrupted or could not be decoded.');
  }

  try {
    const primary = images[0];
    if (!primary) throw new UnreadableImageError('The HEIC file contains no image.');
    if (primary.width * primary.height > maxPixels) {
      throw new UnreadableImageError(
        `Image is larger than the ${Math.round(maxPixels / 1e6)} megapixel limit.`,
      );
    }
    const { width, height, data } = await primary.decode();
    const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return sharp(pixels, { raw: { width, height, channels: 4 } });
  } catch (error) {
    if (error instanceof UnreadableImageError) throw error;
    throw new UnreadableImageError('The HEIC file is corrupted or could not be decoded.');
  } finally {
    images.dispose();
  }
}
