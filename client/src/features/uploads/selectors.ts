import type { ImageDto, ImageStatus } from '../../api/types';
import { formatBytes, formatDimensions } from '../../lib/format';
import type { Section, UploadItem, UploadsState } from './uploadsReducer';

export type CardStatus = ImageStatus | 'queued' | 'uploading' | 'blocked' | 'error';

export interface CardReason {
  code: string;
  message: string;
}

/** Everything a card needs to render, whether it is a local upload or a stored image. */
export interface CardModel {
  key: string;
  name: string;
  status: CardStatus;
  previewUrl: string | null;
  progress: number | null;
  meta: string | null;
  reasons: CardReason[];
  error: string | null;
  imageId: string | null;
  localId: string | null;
  downloadUrl: string | null;
}

const IN_PROGRESS_PHASES = new Set<UploadItem['phase']>([
  'queued',
  'uploading',
  'processing',
  'error',
]);

export function selectInProgressCards(state: UploadsState): CardModel[] {
  return state.uploads.filter((upload) => IN_PROGRESS_PHASES.has(upload.phase)).map(uploadCard);
}

export function selectSectionCards(state: UploadsState, section: Section): CardModel[] {
  // Prefer the local object URL: it is instant and avoids a flash while the thumbnail loads.
  const localPreviews = new Map<string, string>();
  for (const upload of state.uploads) {
    if (upload.imageId && upload.previewUrl) localPreviews.set(upload.imageId, upload.previewUrl);
  }

  const cards = state.sections[section].ids
    .map((id) => state.images[id])
    .filter((image): image is ImageDto => image !== undefined)
    .map((image) => imageCard(image, localPreviews.get(image.id) ?? null));

  if (section !== 'rejected') return cards;
  const blocked = state.uploads.filter((upload) => upload.phase === 'blocked').map(uploadCard);
  return [...blocked, ...cards];
}

/**
 * Server totals cover pages not loaded yet. The summary refresh is debounced, so the
 * count never drops below the number of cards already on screen.
 */
export function selectSectionCount(state: UploadsState, section: Section): number {
  const { summary } = state;
  const loaded = state.sections[section].ids.length;
  if (section === 'accepted') return Math.max(summary?.accepted ?? 0, loaded);
  const blocked = state.uploads.filter((upload) => upload.phase === 'blocked').length;
  return blocked + Math.max(summary ? summary.rejected + summary.failed : 0, loaded);
}

function uploadCard(upload: UploadItem): CardModel {
  const status: CardStatus = upload.phase === 'done' ? 'processing' : upload.phase;
  return {
    key: upload.localId,
    name: upload.name,
    status,
    previewUrl: upload.previewUrl,
    progress: upload.phase === 'uploading' ? upload.progress : null,
    meta: formatBytes(upload.sizeBytes),
    reasons: upload.reasons.map((message) => ({ code: 'NOT_UPLOADED', message })),
    error: upload.error,
    imageId: upload.imageId,
    localId: upload.localId,
    downloadUrl: null,
  };
}

function imageCard(image: ImageDto, localPreview: string | null): CardModel {
  const reasons: CardReason[] = image.rejectionReasons.map(({ code, message }) => ({
    code,
    message,
  }));
  if (image.status === 'failed') {
    reasons.push({ code: 'PROCESSING_FAILED', message: image.error ?? 'Processing failed.' });
  }
  return {
    key: image.id,
    name: image.originalFilename,
    status: image.status,
    previewUrl: localPreview ?? image.urls.thumbnail,
    progress: null,
    meta: [
      formatDimensions(image.width, image.height),
      formatBytes(image.sizeBytes),
      image.format.toUpperCase(),
    ]
      .filter(Boolean)
      .join(' · '),
    reasons,
    error: null,
    imageId: image.id,
    localId: null,
    // HEIC originals are offered as the converted JPEG, which every device can open.
    downloadUrl: image.urls.converted ?? image.urls.original,
  };
}
