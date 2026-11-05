import type { ImageFormat } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { detectImageFormat, SIGNATURE_BYTES } from '../../lib/imageSignature';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif'] as const;
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

/** Value for the file input's `accept` attribute. */
export const FILE_INPUT_ACCEPT = [
  ...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`),
  ...ACCEPTED_MIME_TYPES,
].join(',');

export type FileValidationResult =
  { ok: true; format: ImageFormat } | { ok: false; reasons: string[] };

const UNSUPPORTED_MESSAGE = 'Unsupported format. Upload a JPG, PNG or HEIC image.';

/**
 * Checks a file before upload: extension, declared type, size and the actual
 * leading bytes, so a renamed file is caught too. The server repeats these checks.
 */
export async function validateFile(file: File): Promise<FileValidationResult> {
  const reasons: string[] = [];
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  // Browsers often report an empty type for HEIC, so only a non-empty type is checked.
  const typeIsAllowed = file.type === '' || ACCEPTED_MIME_TYPES.has(file.type.toLowerCase());
  const extensionIsAllowed = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);

  if (!extensionIsAllowed || !typeIsAllowed) reasons.push(UNSUPPORTED_MESSAGE);
  if (file.size === 0) reasons.push('The file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    reasons.push(
      `File is ${formatBytes(file.size)}; the maximum is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    );
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const header = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const format = detectImageFormat(header);
  if (!format) {
    return { ok: false, reasons: ['File contents are not a valid JPG, PNG or HEIC image.'] };
  }
  return { ok: true, format };
}
