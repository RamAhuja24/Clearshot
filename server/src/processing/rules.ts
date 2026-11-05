import type { ValidationConfig } from '../config/env.js';
import type { RejectionReason } from '../modules/images/domain.js';

export interface SimilarityMatch {
  imageId: string;
  /** Hamming distance between perceptual hashes, 0 to 64 bits. */
  distance: number;
  exact: boolean;
}

/** Everything the rules need to know about one image. Produced by the analyzers. */
export interface ImageAnalysis {
  sizeBytes: number;
  width: number;
  height: number;
  sharpness: number;
  faceCount: number;
  /** Area of the largest face divided by the image area, or null when there is no face. */
  largestFaceAreaRatio: number | null;
  similarity: SimilarityMatch | null;
}

/**
 * Pure and deterministic: returns every rule the image fails, not just the first,
 * so users can fix all problems in one go. An empty list means accepted.
 */
export function evaluateRules(analysis: ImageAnalysis, rules: ValidationConfig): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const { width, height } = analysis;

  if (analysis.sizeBytes < rules.minFileBytes) {
    reasons.push({
      code: 'FILE_TOO_SMALL',
      message: `File is only ${formatBytes(analysis.sizeBytes)}; the minimum is ${formatBytes(rules.minFileBytes)}.`,
      details: { sizeBytes: analysis.sizeBytes, minBytes: rules.minFileBytes },
    });
  }

  if (Math.min(width, height) < rules.minDimensionPx) {
    reasons.push({
      code: 'RESOLUTION_TOO_LOW',
      message: `Resolution is ${width}×${height}px; the shorter side must be at least ${rules.minDimensionPx}px.`,
      details: { width, height, minDimensionPx: rules.minDimensionPx },
    });
  }

  if (analysis.sharpness < rules.blurMinScore) {
    reasons.push({
      code: 'BLURRY',
      message: `Image is too blurry (sharpness ${Math.round(analysis.sharpness)}, minimum ${rules.blurMinScore}).`,
      details: { sharpness: round(analysis.sharpness, 1), minSharpness: rules.blurMinScore },
    });
  }

  if (analysis.faceCount === 0 && rules.rejectNoFace) {
    reasons.push({
      code: 'NO_FACE',
      message: 'No face detected. Use a photo where your face is clearly visible.',
    });
  } else if (analysis.faceCount > 1) {
    reasons.push({
      code: 'MULTIPLE_FACES',
      message: `${analysis.faceCount} faces detected; the photo must show only one person.`,
      details: { faceCount: analysis.faceCount },
    });
  } else if (
    analysis.faceCount === 1 &&
    analysis.largestFaceAreaRatio !== null &&
    analysis.largestFaceAreaRatio < rules.faceMinAreaRatio
  ) {
    reasons.push({
      code: 'FACE_TOO_SMALL',
      message: `Face covers ${formatPercent(analysis.largestFaceAreaRatio)} of the image; it must cover at least ${formatPercent(rules.faceMinAreaRatio)}.`,
      details: {
        faceAreaRatio: round(analysis.largestFaceAreaRatio, 4),
        minFaceAreaRatio: rules.faceMinAreaRatio,
      },
    });
  }

  if (analysis.similarity) {
    const { imageId, distance, exact } = analysis.similarity;
    reasons.push(
      exact
        ? {
            code: 'DUPLICATE',
            message: 'This exact image has already been uploaded.',
            details: { similarToId: imageId },
          }
        : {
            code: 'TOO_SIMILAR',
            message: `Too similar to an image already accepted (${Math.round((1 - distance / 64) * 100)}% match).`,
            details: { similarToId: imageId, hammingDistance: distance },
          },
    );
  }

  return reasons;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024, 1)} KB`;
  return `${round(bytes / (1024 * 1024), 1)} MB`;
}

function formatPercent(ratio: number): string {
  return `${round(ratio * 100, 1)}%`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
