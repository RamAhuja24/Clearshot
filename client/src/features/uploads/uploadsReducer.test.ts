import { describe, expect, it } from 'vitest';
import type { ImageDto, ImageStatus } from '../../api/types';
import { selectInProgressCards, selectSectionCards, selectSectionCount } from './selectors';
import {
  initialUploadsState,
  uploadsReducer,
  type UploadItem,
  type UploadsState,
} from './uploadsReducer';

function image(id: string, status: ImageStatus, createdAt: string): ImageDto {
  return {
    id,
    originalFilename: `${id}.jpg`,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    width: 800,
    height: 1000,
    status,
    rejectionReasons: status === 'rejected' ? [{ code: 'BLURRY', message: 'Too blurry.' }] : [],
    metrics: { blurScore: 10, faceCount: 1, faceAreaRatio: 0.2 },
    similarToId: null,
    urls: { thumbnail: `/thumb/${id}`, original: `/orig/${id}`, converted: null },
    error: null,
    createdAt,
    processedAt: null,
  };
}

function upload(localId: string, patch: Partial<UploadItem> = {}): UploadItem {
  return {
    localId,
    file: new File(['x'], `${localId}.jpg`),
    name: `${localId}.jpg`,
    sizeBytes: 1,
    previewUrl: `blob:${localId}`,
    phase: 'queued',
    progress: 0,
    imageId: null,
    reasons: [],
    error: null,
    addedAt: 0,
    ...patch,
  };
}

const run = (state: UploadsState, ...actions: Parameters<typeof uploadsReducer>[1][]) =>
  actions.reduce(uploadsReducer, state);

describe('uploadsReducer', () => {
  it('moves an upload from queued to processing to its section', () => {
    const processing = image('img-1', 'processing', '2026-01-01T00:00:01Z');
    let state = run(
      initialUploadsState,
      { type: 'uploads/added', items: [upload('a')] },
      { type: 'uploads/started', localId: 'a' },
      { type: 'uploads/progressed', localId: 'a', progress: 0.5 },
    );
    expect(selectInProgressCards(state)[0]).toMatchObject({ status: 'uploading', progress: 0.5 });

    state = run(
      state,
      { type: 'uploads/sent', localId: 'a', image: processing },
      { type: 'images/received', image: { ...processing, status: 'accepted' } },
    );
    expect(selectInProgressCards(state)).toEqual([]);
    const [card] = selectSectionCards(state, 'accepted');
    // The instant local preview is preferred over the server thumbnail.
    expect(card).toMatchObject({ imageId: 'img-1', status: 'accepted', previewUrl: 'blob:a' });
  });

  it('keeps the final status when the worker finishes before the upload response arrives', () => {
    const done = image('img-1', 'rejected', '2026-01-01T00:00:01Z');
    const state = run(
      initialUploadsState,
      { type: 'uploads/added', items: [upload('a', { phase: 'uploading' })] },
      { type: 'images/received', image: done },
      {
        type: 'uploads/sent',
        localId: 'a',
        image: { ...done, status: 'processing', rejectionReasons: [] },
      },
    );
    expect(state.images['img-1']?.status).toBe('rejected');
    expect(state.uploads[0]?.phase).toBe('done');
    expect(selectInProgressCards(state)).toEqual([]);
  });

  it('ignores progress updates that do not change the rounded value', () => {
    const state = run(
      initialUploadsState,
      { type: 'uploads/added', items: [upload('a')] },
      { type: 'uploads/started', localId: 'a' },
      { type: 'uploads/progressed', localId: 'a', progress: 0.501 },
    );
    expect(
      uploadsReducer(state, { type: 'uploads/progressed', localId: 'a', progress: 0.503 }),
    ).toBe(state);
  });

  it('inserts live results in newest-first order and moves them between sections', () => {
    const page = {
      data: [
        image('new', 'accepted', '2026-01-03T00:00:00Z'),
        image('old', 'accepted', '2026-01-01T00:00:00Z'),
      ],
      nextCursor: null,
    };
    let state = run(
      initialUploadsState,
      { type: 'section/loaded', section: 'accepted', page, append: false },
      { type: 'images/received', image: image('mid', 'accepted', '2026-01-02T00:00:00Z') },
    );
    expect(state.sections.accepted.ids).toEqual(['new', 'mid', 'old']);

    state = run(state, { type: 'images/removed', id: 'mid' });
    expect(state.sections.accepted.ids).toEqual(['new', 'old']);
    expect(state.images.mid).toBeUndefined();
  });

  it('leaves images older than the loaded page for "Load more"', () => {
    const page = { data: [image('new', 'rejected', '2026-01-03T00:00:00Z')], nextCursor: 'cursor' };
    const state = run(
      initialUploadsState,
      { type: 'section/loaded', section: 'rejected', page, append: false },
      { type: 'images/received', image: image('older', 'rejected', '2026-01-01T00:00:00Z') },
    );
    expect(state.sections.rejected.ids).toEqual(['new']);
  });

  it('shows locally blocked files in Rejected and counts them', () => {
    const state = run(
      initialUploadsState,
      {
        type: 'summary/loaded',
        summary: { processing: 0, accepted: 4, rejected: 2, failed: 1, total: 7 },
      },
      {
        type: 'uploads/added',
        items: [
          upload('bad', { phase: 'blocked', previewUrl: null, reasons: ['Unsupported format.'] }),
        ],
      },
    );
    const [card] = selectSectionCards(state, 'rejected');
    expect(card).toMatchObject({
      status: 'blocked',
      reasons: [{ message: 'Unsupported format.' }],
    });
    expect(selectSectionCount(state, 'rejected')).toBe(4);
    expect(selectSectionCount(state, 'accepted')).toBe(4);
  });
});
