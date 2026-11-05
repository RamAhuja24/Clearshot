import { rasterToSharp, type Raster } from '../raster.js';

const HASH_WIDTH = 8;
const HASH_HEIGHT = 8;

/**
 * 64-bit difference hash (dHash). The image is shrunk to 9×8 grayscale, and each
 * bit records whether a pixel is brighter than its right-hand neighbour. Resizing,
 * re-compression and small colour changes barely move the hash, so a small Hamming
 * distance between two hashes means the images look alike.
 */
export async function differenceHash(raster: Raster): Promise<bigint> {
  const { data } = await rasterToSharp(raster)
    .greyscale()
    .resize(HASH_WIDTH + 1, HASH_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return differenceHashFromPixels(data);
}

/** Computes the hash from 9×8 single-channel pixels, row by row. */
export function differenceHashFromPixels(gray: Uint8Array): bigint {
  const rowLength = HASH_WIDTH + 1;
  if (gray.length !== rowLength * HASH_HEIGHT) {
    throw new Error(`Expected ${rowLength * HASH_HEIGHT} pixels, received ${gray.length}`);
  }

  let hash = 0n;
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH; x++) {
      const brighter = gray[y * rowLength + x]! > gray[y * rowLength + x + 1]!;
      hash = (hash << 1n) | (brighter ? 1n : 0n);
    }
  }
  return hash;
}

/** Number of differing bits between two 64-bit hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = BigInt.asUintN(64, a ^ b);
  let count = 0;
  while (diff !== 0n) {
    diff &= diff - 1n;
    count++;
  }
  return count;
}
