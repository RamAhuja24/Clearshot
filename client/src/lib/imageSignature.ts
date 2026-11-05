import type { ImageFormat } from '../api/types';

// Same rules as the server's detector (server/src/lib/fileType.ts). The server
// re-checks every upload; this copy only gives users instant feedback.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const GENERIC_HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** Number of leading bytes needed to recognise every supported format. */
export const SIGNATURE_BYTES = 64;

export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'png';
  }
  return isHeif(bytes) ? 'heic' : null;
}

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (boxSize < 16) return false;

  const end = Math.min(boxSize, bytes.length);
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4)
    brands.push(ascii(bytes, offset, offset + 4));

  if (brands.some((brand) => HEVC_BRANDS.has(brand))) return true;
  return GENERIC_HEIF_BRANDS.has(brands[0]!) && !brands.some((brand) => AVIF_BRANDS.has(brand));
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
