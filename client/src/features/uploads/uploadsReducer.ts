import type { ImageDto, ImagePage, ImageStatus, ImageSummary } from '../../api/types';

export type Section = 'accepted' | 'rejected';

export const SECTION_STATUSES: Record<Section, ImageStatus[]> = {
  accepted: ['accepted'],
  rejected: ['rejected', 'failed'],
};

export function sectionOf(status: ImageStatus): Section | null {
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected' || status === 'failed') return 'rejected';
  return null;
}

/**
 * Lifecycle of a file picked in this browser tab:
 * queued → uploading → processing (server is validating) → done,
 * or blocked (refused before or at upload) / error (retryable).
 */
export type UploadPhase = 'queued' | 'uploading' | 'processing' | 'done' | 'blocked' | 'error';

export interface UploadItem {
  localId: string;
  file: File;
  name: string;
  sizeBytes: number;
  /** Object URL for instant previews; null when the browser cannot render the format. */
  previewUrl: string | null;
  phase: UploadPhase;
  progress: number;
  imageId: string | null;
  reasons: string[];
  error: string | null;
  addedAt: number;
}

export interface SectionState {
  ids: string[];
  nextCursor: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface UploadsState {
  /** Newest first. */
  uploads: UploadItem[];
  /** Server images by id: the single source of truth for statuses. */
  images: Record<string, ImageDto>;
  sections: Record<Section, SectionState>;
  summary: ImageSummary | null;
}

export type UploadsAction =
  | { type: 'uploads/added'; items: UploadItem[] }
  | { type: 'uploads/started'; localId: string }
  | { type: 'uploads/progressed'; localId: string; progress: number }
  | { type: 'uploads/sent'; localId: string; image: ImageDto }
  | { type: 'uploads/blocked'; localId: string; reason: string }
  | { type: 'uploads/failed'; localId: string; error: string }
  | { type: 'uploads/retried'; localId: string }
  | { type: 'uploads/dismissed'; localId: string }
  | { type: 'images/received'; image: ImageDto }
  | { type: 'images/removed'; id: string }
  | { type: 'section/loading'; section: Section }
  | { type: 'section/loaded'; section: Section; page: ImagePage; append: boolean }
  | { type: 'section/failed'; section: Section; error: string }
  | { type: 'summary/loaded'; summary: ImageSummary };

const emptySection = (): SectionState => ({
  ids: [],
  nextCursor: null,
  loading: false,
  loaded: false,
  error: null,
});

export const initialUploadsState: UploadsState = {
  uploads: [],
  images: {},
  sections: { accepted: emptySection(), rejected: emptySection() },
  summary: null,
};

export function uploadsReducer(state: UploadsState, action: UploadsAction): UploadsState {
  switch (action.type) {
    case 'uploads/added':
      return { ...state, uploads: [...action.items, ...state.uploads] };

    case 'uploads/started':
      return updateUpload(state, action.localId, { phase: 'uploading', progress: 0, error: null });

    case 'uploads/progressed': {
      // Round to whole percents so progress events don't re-render on every byte.
      const progress = Math.round(action.progress * 100) / 100;
      const item = state.uploads.find((u) => u.localId === action.localId);
      if (!item || item.phase !== 'uploading' || item.progress === progress) return state;
      return updateUpload(state, action.localId, { progress });
    }

    case 'uploads/sent': {
      // The worker can finish before the upload response arrives. If the final
      // status is already known, keep it instead of the older "processing" copy.
      const known = state.images[action.image.id];
      const finished = known !== undefined && known.status !== 'processing';
      const withImage = finished
        ? state
        : { ...state, images: { ...state.images, [action.image.id]: action.image } };
      return updateUpload(withImage, action.localId, {
        phase: finished ? 'done' : 'processing',
        progress: 1,
        imageId: action.image.id,
      });
    }

    case 'uploads/blocked':
      return updateUpload(state, action.localId, { phase: 'blocked', reasons: [action.reason] });

    case 'uploads/failed':
      return updateUpload(state, action.localId, { phase: 'error', error: action.error });

    case 'uploads/retried':
      return updateUpload(state, action.localId, { phase: 'queued', progress: 0, error: null });

    case 'uploads/dismissed':
      return { ...state, uploads: state.uploads.filter((u) => u.localId !== action.localId) };

    case 'images/received': {
      const { image } = action;
      const images = { ...state.images, [image.id]: image };
      const target = sectionOf(image.status);
      const uploads = target
        ? state.uploads.map((u) => (u.imageId === image.id ? { ...u, phase: 'done' as const } : u))
        : state.uploads;
      return {
        ...state,
        images,
        uploads,
        sections: placeInSection(state.sections, images, image.id, target),
      };
    }

    case 'images/removed': {
      const { [action.id]: _removed, ...images } = state.images;
      return {
        ...state,
        images,
        uploads: state.uploads.filter((u) => u.imageId !== action.id),
        sections: placeInSection(state.sections, images, action.id, null),
      };
    }

    case 'section/loading':
      return updateSection(state, action.section, { loading: true, error: null });

    case 'section/loaded': {
      const images = { ...state.images };
      for (const image of action.page.data) images[image.id] = image;
      const current = state.sections[action.section];
      const incoming = action.page.data.map((image) => image.id);
      const ids = action.append ? [...new Set([...current.ids, ...incoming])] : incoming;
      return {
        ...state,
        images,
        sections: {
          ...state.sections,
          [action.section]: {
            ids,
            nextCursor: action.page.nextCursor,
            loading: false,
            loaded: true,
            error: null,
          },
        },
      };
    }

    case 'section/failed':
      return updateSection(state, action.section, { loading: false, error: action.error });

    case 'summary/loaded':
      return { ...state, summary: action.summary };
  }
}

function updateUpload(
  state: UploadsState,
  localId: string,
  patch: Partial<UploadItem>,
): UploadsState {
  return {
    ...state,
    uploads: state.uploads.map((u) => (u.localId === localId ? { ...u, ...patch } : u)),
  };
}

function updateSection(
  state: UploadsState,
  section: Section,
  patch: Partial<SectionState>,
): UploadsState {
  return {
    ...state,
    sections: { ...state.sections, [section]: { ...state.sections[section], ...patch } },
  };
}

/**
 * Moves an image id into its section (or out of all sections when `target` is null),
 * keeping newest-first order. An image older than everything loaded so far is left
 * for "Load more" to fetch, so the list never has gaps.
 */
function placeInSection(
  sections: UploadsState['sections'],
  images: Record<string, ImageDto>,
  id: string,
  target: Section | null,
): UploadsState['sections'] {
  const next = { ...sections };
  for (const key of Object.keys(next) as Section[]) {
    const section = next[key];
    const without = section.ids.filter((existing) => existing !== id);
    if (key !== target) {
      if (without.length !== section.ids.length) next[key] = { ...section, ids: without };
      continue;
    }

    const createdAt = images[id]!.createdAt;
    const index = without.findIndex((other) => (images[other]?.createdAt ?? '') < createdAt);
    if (index === -1 && section.nextCursor !== null) {
      next[key] = { ...section, ids: without };
      continue;
    }
    const position = index === -1 ? without.length : index;
    next[key] = {
      ...section,
      ids: [...without.slice(0, position), id, ...without.slice(position)],
    };
  }
  return next;
}
