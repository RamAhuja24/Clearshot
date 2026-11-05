/** A detection in normalised model coordinates (0–1), corner form. */
export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

/**
 * Reads UltraFace outputs: `scores` is [N, 2] (background, face) and `boxes` is
 * [N, 4] corner-form boxes that the exported model has already decoded from anchors.
 */
export function decodeDetections(
  scores: Float32Array,
  boxes: Float32Array,
  minConfidence: number,
): Detection[] {
  const detections: Detection[] = [];
  const count = scores.length / 2;
  for (let i = 0; i < count; i++) {
    const score = scores[i * 2 + 1]!;
    if (score < minConfidence) continue;
    detections.push({
      x1: clamp01(boxes[i * 4]!),
      y1: clamp01(boxes[i * 4 + 1]!),
      x2: clamp01(boxes[i * 4 + 2]!),
      y2: clamp01(boxes[i * 4 + 3]!),
      score,
    });
  }
  return detections;
}

/** Greedy non-maximum suppression: keeps the best box out of each overlapping cluster. */
export function nonMaxSuppression(detections: Detection[], iouThreshold: number): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...detections].sort((a, b) => b.score - a.score)) {
    if (kept.every((box) => intersectionOverUnion(box, candidate) <= iouThreshold)) {
      kept.push(candidate);
    }
  }
  return kept;
}

export function intersectionOverUnion(a: Detection, b: Detection): number {
  const width = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const height = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const union = area(a) + area(b) - intersection;
  return union > 0 ? intersection / union : 0;
}

const area = (d: Detection) => Math.max(0, d.x2 - d.x1) * Math.max(0, d.y2 - d.y1);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
