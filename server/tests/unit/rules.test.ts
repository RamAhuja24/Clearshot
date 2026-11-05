import { describe, expect, it } from 'vitest';
import type { ValidationConfig } from '../../src/config/env.js';
import { evaluateRules, type ImageAnalysis } from '../../src/processing/rules.js';

const rules: ValidationConfig = {
  minFileBytes: 20 * 1024,
  minDimensionPx: 512,
  maxPixels: 50_000_000,
  blurMinScore: 100,
  similarityMaxDistance: 8,
  faceMinConfidence: 0.7,
  faceMinAreaRatio: 0.03,
  rejectNoFace: true,
};

const goodPhoto: ImageAnalysis = {
  sizeBytes: 500_000,
  width: 1200,
  height: 1600,
  sharpness: 800,
  faceCount: 1,
  largestFaceAreaRatio: 0.2,
  similarity: null,
};

const codes = (analysis: Partial<ImageAnalysis>, overrides: Partial<ValidationConfig> = {}) =>
  evaluateRules({ ...goodPhoto, ...analysis }, { ...rules, ...overrides }).map((r) => r.code);

describe('evaluateRules', () => {
  it('accepts a photo that passes every check', () => {
    expect(codes({})).toEqual([]);
  });

  it('rejects files that are too small in bytes or resolution', () => {
    expect(codes({ sizeBytes: 10_000 })).toEqual(['FILE_TOO_SMALL']);
    expect(codes({ width: 400, height: 2000 })).toEqual(['RESOLUTION_TOO_LOW']);
    expect(codes({ width: 512, height: 512 })).toEqual([]);
  });

  it('rejects blurry photos', () => {
    expect(codes({ sharpness: 99.9 })).toEqual(['BLURRY']);
    expect(codes({ sharpness: 100 })).toEqual([]);
  });

  it('applies the face rules', () => {
    expect(codes({ faceCount: 0, largestFaceAreaRatio: null })).toEqual(['NO_FACE']);
    expect(codes({ faceCount: 0, largestFaceAreaRatio: null }, { rejectNoFace: false })).toEqual(
      [],
    );
    expect(codes({ faceCount: 3 })).toEqual(['MULTIPLE_FACES']);
    expect(codes({ largestFaceAreaRatio: 0.01 })).toEqual(['FACE_TOO_SMALL']);
  });

  it('distinguishes exact duplicates from near-duplicates', () => {
    expect(codes({ similarity: { imageId: 'a', distance: 0, exact: true } })).toEqual([
      'DUPLICATE',
    ]);
    const [reason] = evaluateRules(
      { ...goodPhoto, similarity: { imageId: 'a', distance: 6, exact: false } },
      rules,
    );
    expect(reason).toMatchObject({
      code: 'TOO_SIMILAR',
      message: expect.stringContaining('91% match'),
      details: { similarToId: 'a', hammingDistance: 6 },
    });
  });

  it('reports every failing rule, with readable messages', () => {
    const reasons = evaluateRules(
      { ...goodPhoto, sizeBytes: 9_000, width: 300, height: 400, sharpness: 12, faceCount: 2 },
      rules,
    );
    expect(reasons.map((r) => r.code)).toEqual([
      'FILE_TOO_SMALL',
      'RESOLUTION_TOO_LOW',
      'BLURRY',
      'MULTIPLE_FACES',
    ]);
    expect(reasons[1]?.message).toBe(
      'Resolution is 300×400px; the shorter side must be at least 512px.',
    );
  });
});
