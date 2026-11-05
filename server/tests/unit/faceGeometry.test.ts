import { describe, expect, it } from 'vitest';
import {
  decodeDetections,
  intersectionOverUnion,
  nonMaxSuppression,
  type Detection,
} from '../../src/processing/analyzers/faceGeometry.js';

const box = (x1: number, y1: number, x2: number, y2: number, score = 0.9): Detection => ({
  x1,
  y1,
  x2,
  y2,
  score,
});

describe('intersectionOverUnion', () => {
  it('is 1 for identical boxes and 0 for disjoint ones', () => {
    expect(intersectionOverUnion(box(0, 0, 1, 1), box(0, 0, 1, 1))).toBe(1);
    expect(intersectionOverUnion(box(0, 0, 0.2, 0.2), box(0.5, 0.5, 0.7, 0.7))).toBe(0);
  });

  it('computes partial overlap', () => {
    // Two 0.2×0.2 boxes overlapping by half: intersection 0.02, union 0.06.
    expect(intersectionOverUnion(box(0, 0, 0.2, 0.2), box(0.1, 0, 0.3, 0.2))).toBeCloseTo(1 / 3);
  });
});

describe('nonMaxSuppression', () => {
  it('keeps the best box of each overlapping cluster', () => {
    const kept = nonMaxSuppression(
      [box(0.1, 0.1, 0.3, 0.3, 0.8), box(0.11, 0.1, 0.31, 0.3, 0.95), box(0.6, 0.6, 0.8, 0.8, 0.9)],
      0.3,
    );
    expect(kept.map((d) => d.score)).toEqual([0.95, 0.9]);
  });
});

describe('decodeDetections', () => {
  it('keeps confident face anchors and clamps their boxes', () => {
    const scores = new Float32Array([0.9, 0.1, 0.05, 0.95, 0.2, 0.8]);
    const boxes = new Float32Array([0, 0, 1, 1, -0.1, 0.2, 0.4, 1.3, 0.5, 0.5, 0.6, 0.6]);
    const detections = decodeDetections(scores, boxes, 0.7);
    expect(detections).toHaveLength(2);
    // Float32 inputs, so compare approximately.
    expect(detections[0]).toMatchObject({ x1: 0, y1: expect.closeTo(0.2), y2: 1 });
    expect(detections[0]?.score).toBeCloseTo(0.95);
  });
});
