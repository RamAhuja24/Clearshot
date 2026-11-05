import type { ImageFormat } from '../../lib/fileType.js';

export const IMAGE_STATUSES = ['processing', 'accepted', 'rejected', 'failed'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

/** Reasons produced by the asynchronous validation pipeline (persisted). */
export const REJECTION_CODES = [
  'FILE_TOO_SMALL',
  'RESOLUTION_TOO_LOW',
  'UNREADABLE_IMAGE',
  'BLURRY',
  'DUPLICATE',
  'TOO_SIMILAR',
  'NO_FACE',
  'MULTIPLE_FACES',
  'FACE_TOO_SMALL',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface RejectionReason {
  code: RejectionCode;
  message: string;
  details?: Record<string, unknown>;
}

export const CONTENT_VARIANTS = ['thumbnail', 'original', 'converted'] as const;
export type ContentVariant = (typeof CONTENT_VARIANTS)[number];

/** Row shape of the `images` table. */
export interface ImageRecord {
  id: string;
  original_filename: string;
  format: ImageFormat;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  phash: string | null; // bigint, returned by pg as a string
  status: ImageStatus;
  blur_score: number | null;
  face_count: number | null;
  face_area_ratio: number | null;
  similar_to_id: string | null;
  original_key: string;
  converted_key: string | null;
  thumbnail_key: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
}

export interface ImageWithReasons {
  image: ImageRecord;
  reasons: RejectionReason[];
}
