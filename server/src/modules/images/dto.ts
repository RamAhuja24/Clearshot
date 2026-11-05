import type { ImageFormat } from '../../lib/fileType.js';
import type { ImageRecord, ImageStatus, RejectionReason } from './domain.js';

/** Public representation of an image. This is the API contract shared with the client. */
export interface ImageDto {
  id: string;
  originalFilename: string;
  format: ImageFormat;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReasons: RejectionReason[];
  metrics: {
    blurScore: number | null;
    faceCount: number | null;
    faceAreaRatio: number | null;
  };
  similarToId: string | null;
  urls: {
    thumbnail: string | null;
    original: string;
    converted: string | null;
  };
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

const contentUrl = (id: string, variant: string) => `/api/images/${id}/content?variant=${variant}`;

export function toImageDto(image: ImageRecord, reasons: RejectionReason[]): ImageDto {
  return {
    id: image.id,
    originalFilename: image.original_filename,
    format: image.format,
    mimeType: image.mime_type,
    sizeBytes: image.size_bytes,
    width: image.width,
    height: image.height,
    status: image.status,
    rejectionReasons: reasons,
    metrics: {
      blurScore: image.blur_score,
      faceCount: image.face_count,
      faceAreaRatio: image.face_area_ratio,
    },
    similarToId: image.similar_to_id,
    urls: {
      thumbnail: image.thumbnail_key ? contentUrl(image.id, 'thumbnail') : null,
      original: contentUrl(image.id, 'original'),
      converted: image.converted_key ? contentUrl(image.id, 'converted') : null,
    },
    error: image.error_message,
    createdAt: image.created_at.toISOString(),
    processedAt: image.processed_at?.toISOString() ?? null,
  };
}
