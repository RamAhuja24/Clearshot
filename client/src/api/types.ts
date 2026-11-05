// Mirrors the server's public contract (server/src/modules/images/dto.ts).

export type ImageFormat = 'jpeg' | 'png' | 'heic';
export type ImageStatus = 'processing' | 'accepted' | 'rejected' | 'failed';

export type RejectionCode =
  | 'FILE_TOO_SMALL'
  | 'RESOLUTION_TOO_LOW'
  | 'UNREADABLE_IMAGE'
  | 'BLURRY'
  | 'DUPLICATE'
  | 'TOO_SIMILAR'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL';

export interface RejectionReason {
  code: RejectionCode;
  message: string;
  details?: Record<string, unknown>;
}

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

export interface ImagePage {
  data: ImageDto[];
  nextCursor: string | null;
}

export type ImageSummary = Record<ImageStatus, number> & { total: number };

export type ImageEvent =
  { type: 'image.updated'; image: ImageDto } | { type: 'image.deleted'; id: string };
