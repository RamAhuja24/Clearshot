import { useEffect, useEffectEvent, useRef, type Dispatch } from 'react';
import { api, ApiError } from '../../api/client';
import type { ImageDto } from '../../api/types';
import type { UploadItem, UploadsAction } from './uploadsReducer';

export const MAX_PARALLEL_UPLOADS = 3;

/**
 * Uploads queued files a few at a time. Each file is its own request, so one
 * failure never affects the rest, and each card gets its own progress bar.
 */
export function useUploadQueue(
  uploads: UploadItem[],
  dispatch: Dispatch<UploadsAction>,
  onSent: (image: ImageDto) => void,
): void {
  const inFlight = useRef(new Map<string, AbortController>());
  const notifySent = useEffectEvent(onSent);

  useEffect(() => {
    const freeSlots = MAX_PARALLEL_UPLOADS - inFlight.current.size;
    if (freeSlots <= 0) return;

    const next = uploads
      .filter((upload) => upload.phase === 'queued' && !inFlight.current.has(upload.localId))
      .sort((a, b) => a.addedAt - b.addedAt)
      .slice(0, freeSlots);

    for (const upload of next) {
      const controller = new AbortController();
      // Tracked in a ref so a re-run of this effect (e.g. React StrictMode) never starts it twice.
      inFlight.current.set(upload.localId, controller);
      dispatch({ type: 'uploads/started', localId: upload.localId });
      void send(upload, controller.signal);
    }

    async function send(upload: UploadItem, signal: AbortSignal) {
      const { localId } = upload;
      try {
        const image = await api.uploadImage(upload.file, {
          signal,
          onProgress: (progress) => dispatch({ type: 'uploads/progressed', localId, progress }),
        });
        inFlight.current.delete(localId);
        dispatch({ type: 'uploads/sent', localId, image });
        notifySent(image);
      } catch (error) {
        inFlight.current.delete(localId);
        if (error instanceof ApiError && error.isPermanentRejection) {
          dispatch({ type: 'uploads/blocked', localId, reason: error.message });
        } else {
          const message = error instanceof Error ? error.message : 'Upload failed.';
          dispatch({ type: 'uploads/failed', localId, error: message });
        }
      }
    }
  }, [uploads, dispatch]);

  // Cancel any running uploads when the provider unmounts.
  useEffect(() => {
    const controllers = inFlight.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);
}
