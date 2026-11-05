const MAX_FILENAME_LENGTH = 200;
// Control characters plus characters that are unsafe in filenames or headers.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/**
 * Multipart parsers decode filenames as latin1, so UTF-8 names arrive garbled.
 * Re-decode when the bytes form valid UTF-8; otherwise keep the original.
 */
export function decodeMultipartFilename(name: string): string {
  const reDecoded = Buffer.from(name, 'latin1').toString('utf8');
  return reDecoded.includes('�') ? name : reDecoded;
}

/**
 * Produces a display-only filename. It is never used to build storage keys or paths.
 */
export function sanitizeFilename(name: string | undefined, fallback = 'image'): string {
  const baseName = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = baseName
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');

  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;

  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
}
