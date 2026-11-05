export const IMAGE_FORMATS = ['jpeg', 'png', 'heic'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const MIME_TYPE_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

export const EXTENSION_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  heic: 'heic',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// HEVC-coded HEIF brands. Generic HEIF brands (mif1/msf1) are also accepted,
// unless the file declares itself AVIF, which shares the same container.
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const GENERIC_HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/**
 * Identifies the image format from its leading bytes ("magic numbers").
 * The client-supplied filename and Content-Type are never trusted.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'png';
  }
  if (isHeif(bytes)) return 'heic';
  return null;
}

function isHeif(bytes: Uint8Array): boolean {
  // ISO-BMFF: [box size: u32][ 'ftyp' ][major brand][minor version][compatible brands...]
  if (bytes.length < 16 || ascii(bytes, 4, 8) !== 'ftyp') return false;

  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (boxSize < 16) return false;

  const end = Math.min(boxSize, bytes.length);
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, offset + 4));
  }

  if (brands.some((brand) => HEVC_BRANDS.has(brand))) return true;
  const isGenericHeif = GENERIC_HEIF_BRANDS.has(brands[0]!);
  return isGenericHeif && !brands.some((brand) => AVIF_BRANDS.has(brand));
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
