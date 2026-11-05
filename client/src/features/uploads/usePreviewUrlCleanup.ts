import { useEffect, useRef } from 'react';
import type { UploadItem } from './uploadsReducer';

/** Revokes object URLs once no upload references them, and all of them on unmount. */
export function usePreviewUrlCleanup(uploads: UploadItem[]): void {
  const tracked = useRef(new Set<string>());

  useEffect(() => {
    const current = new Set(
      uploads.map((upload) => upload.previewUrl).filter((url): url is string => url !== null),
    );
    for (const url of tracked.current) {
      if (!current.has(url)) URL.revokeObjectURL(url);
    }
    tracked.current = current;
  }, [uploads]);

  useEffect(() => {
    const urls = tracked;
    return () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, []);
}
