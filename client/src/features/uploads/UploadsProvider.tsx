import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../../api/client';
import type { ImageDto } from '../../api/types';
import { useToast } from '../../components/toast/ToastProvider';
import { pluralize } from '../../lib/format';
import { validateFile } from './fileValidation';
import { useImageEvents, type LiveStatus } from './useImageEvents';
import { usePreviewUrlCleanup } from './usePreviewUrlCleanup';
import { useUploadQueue } from './useUploadQueue';
import {
  initialUploadsState,
  SECTION_STATUSES,
  uploadsReducer,
  type Section,
  type UploadItem,
  type UploadsState,
} from './uploadsReducer';

export interface UploadsActions {
  addFiles: (files: File[]) => Promise<void>;
  retryUpload: (localId: string) => void;
  dismissUpload: (localId: string) => void;
  deleteImage: (imageId: string) => Promise<void>;
  loadMore: (section: Section) => void;
  reloadSection: (section: Section) => void;
}

const StateContext = createContext<UploadsState | null>(null);
const ActionsContext = createContext<UploadsActions | null>(null);
const LiveStatusContext = createContext<LiveStatus>('connecting');

/** If an event is missed (e.g. a proxy drops the stream), processing items are polled. */
const POLL_INTERVAL_MS = 5_000;
const SUMMARY_DEBOUNCE_MS = 250;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';

const createId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function UploadsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uploadsReducer, initialUploadsState);
  const [announcement, setAnnouncement] = useState('');
  const notify = useToast();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // --- Server state -------------------------------------------------------

  const summaryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshSummary = useCallback(() => {
    clearTimeout(summaryTimer.current);
    summaryTimer.current = setTimeout(() => {
      api
        .getSummary()
        .then((summary) => dispatch({ type: 'summary/loaded', summary }))
        .catch(() => undefined); // counts fall back to loaded items
    }, SUMMARY_DEBOUNCE_MS);
  }, []);

  const loadSection = useCallback(async (section: Section, cursor: string | null) => {
    dispatch({ type: 'section/loading', section });
    try {
      const page = await api.listImages({ statuses: SECTION_STATUSES[section], cursor });
      dispatch({ type: 'section/loaded', section, page, append: cursor !== null });
    } catch (error) {
      dispatch({ type: 'section/failed', section, error: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void loadSection('accepted', null);
    void loadSection('rejected', null);
    refreshSummary();
    return () => clearTimeout(summaryTimer.current);
  }, [loadSection, refreshSummary]);

  // --- Live updates -------------------------------------------------------

  const announceIfOwn = useCallback((image: ImageDto) => {
    const own = stateRef.current.uploads.some((upload) => upload.imageId === image.id);
    if (!own || image.status === 'processing') return;
    const reason = image.rejectionReasons[0]?.message ?? image.error;
    setAnnouncement(
      image.status === 'accepted'
        ? `${image.originalFilename} was accepted.`
        : `${image.originalFilename} was rejected. ${reason ?? ''}`,
    );
  }, []);

  const receiveImage = useCallback(
    (image: ImageDto) => {
      dispatch({ type: 'images/received', image });
      announceIfOwn(image);
      refreshSummary();
    },
    [announceIfOwn, refreshSummary],
  );

  const syncProcessingUploads = useCallback(async () => {
    const pending = stateRef.current.uploads.filter(
      (upload) => upload.phase === 'processing' && upload.imageId,
    );
    await Promise.all(
      pending.map(async (upload) => {
        try {
          const image = await api.getImage(upload.imageId!);
          if (image.status !== 'processing') receiveImage(image);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            dispatch({ type: 'images/removed', id: upload.imageId! });
          }
        }
      }),
    );
  }, [receiveImage]);

  const liveStatus = useImageEvents({
    onUpdated: receiveImage,
    onDeleted: (id) => {
      dispatch({ type: 'images/removed', id });
      refreshSummary();
    },
    onReconnected: () => {
      void syncProcessingUploads();
      refreshSummary();
    },
  });

  const hasProcessing = state.uploads.some((upload) => upload.phase === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => void syncProcessingUploads(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasProcessing, syncProcessingUploads]);

  // --- Uploads ------------------------------------------------------------

  useUploadQueue(state.uploads, dispatch, refreshSummary);
  usePreviewUrlCleanup(state.uploads);

  const actions = useMemo<UploadsActions>(
    () => ({
      async addFiles(files) {
        if (files.length === 0) return;
        const addedAt = Date.now();
        const items = await Promise.all(
          files.map(async (file): Promise<UploadItem> => {
            const result = await validateFile(file);
            const base = {
              localId: createId(),
              file,
              name: file.name,
              sizeBytes: file.size,
              progress: 0,
              imageId: null,
              error: null,
              addedAt,
            };
            if (!result.ok)
              return { ...base, phase: 'blocked', previewUrl: null, reasons: result.reasons };
            // Most browsers cannot render HEIC; its preview comes from the server thumbnail.
            const previewUrl = result.format === 'heic' ? null : URL.createObjectURL(file);
            return { ...base, phase: 'queued', previewUrl, reasons: [] };
          }),
        );
        dispatch({ type: 'uploads/added', items });

        const blocked = items.filter((item) => item.phase === 'blocked').length;
        const queued = items.length - blocked;
        if (queued > 0) notify(`Uploading ${pluralize(queued, 'photo')}…`, 'info');
        if (blocked > 0) {
          notify(
            `${pluralize(blocked, 'file')} can't be uploaded. See Rejected for details.`,
            'warning',
          );
        }
      },

      retryUpload(localId) {
        dispatch({ type: 'uploads/retried', localId });
      },

      dismissUpload(localId) {
        dispatch({ type: 'uploads/dismissed', localId });
      },

      async deleteImage(imageId) {
        const name = stateRef.current.images[imageId]?.originalFilename ?? 'Photo';
        try {
          await api.deleteImage(imageId);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) {
            notify(`Couldn't delete ${name}: ${errorMessage(error)}`, 'error');
            return;
          }
        }
        dispatch({ type: 'images/removed', id: imageId });
        refreshSummary();
        notify(`Deleted ${name}.`, 'success');
      },

      loadMore(section) {
        const current = stateRef.current.sections[section];
        if (current.loading || !current.nextCursor) return;
        void loadSection(section, current.nextCursor);
      },

      reloadSection(section) {
        void loadSection(section, null);
      },
    }),
    [loadSection, notify, refreshSummary],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>
        <LiveStatusContext.Provider value={liveStatus}>
          {children}
          <div className="visually-hidden" aria-live="polite" aria-atomic="true">
            {announcement}
          </div>
        </LiveStatusContext.Provider>
      </StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useUploadsState(): UploadsState {
  const state = useContext(StateContext);
  if (!state) throw new Error('useUploadsState must be used inside <UploadsProvider>');
  return state;
}

export function useUploadsActions(): UploadsActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('useUploadsActions must be used inside <UploadsProvider>');
  return actions;
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext);
}
