import type { ImageDto, ImagePage, ImageStatus, ImageSummary } from './types';

const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** Errors that retrying cannot fix: the server refused the file itself. */
  get isPermanentRejection(): boolean {
    return this.code === 'UNSUPPORTED_FORMAT' || this.code === 'FILE_TOO_LARGE';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body as ErrorBody | null)?.error;
  return new ApiError(
    status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? `Request failed with status ${status}.`,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

export interface ListImagesParams {
  statuses: ImageStatus[];
  cursor?: string | null;
  limit?: number;
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export const api = {
  listImages({ statuses, cursor, limit = 24 }: ListImagesParams): Promise<ImagePage> {
    const query = new URLSearchParams({ status: statuses.join(','), limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return request(`/images?${query}`);
  },

  getImage(id: string): Promise<ImageDto> {
    return request(`/images/${encodeURIComponent(id)}`);
  },

  getSummary(): Promise<ImageSummary> {
    return request('/images/summary');
  },

  deleteImage(id: string): Promise<void> {
    return request(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Uses XHR rather than fetch, because fetch cannot report upload progress. */
  uploadImage(file: File, { onProgress, signal }: UploadOptions = {}): Promise<ImageDto> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/images`);
      xhr.responseType = 'json';

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status === 202) resolve(xhr.response as ImageDto);
        else reject(toApiError(xhr.status, xhr.response));
      });
      xhr.addEventListener('error', () =>
        reject(
          new ApiError(0, 'NETWORK_ERROR', 'Upload interrupted. Check your connection and retry.'),
        ),
      );
      xhr.addEventListener('abort', () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled.')));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });

      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  },
};

export function eventsUrl(): string {
  return `${API_BASE}/events`;
}
