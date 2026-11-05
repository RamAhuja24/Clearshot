import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { decodeCursor, encodeCursor } from '../../src/modules/images/pagination.js';

describe('pagination cursors', () => {
  it('round-trips with microsecond precision', () => {
    const cursor = {
      createdAt: '2026-11-05T06:12:21.005867Z',
      id: '748e6128-75ec-49c8-8ab3-8c9ffb7b5ea2',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects tampered cursors with a 400', () => {
    for (const bad of ['garbage', encodeCursor({ createdAt: 'yesterday', id: 'x' })]) {
      expect(() => decodeCursor(bad)).toThrow(AppError);
      try {
        decodeCursor(bad);
      } catch (error) {
        expect((error as AppError).status).toBe(400);
      }
    }
  });
});
