import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-node';
import { rasterToSharp, type Raster, type Region } from '../raster.js';
import { decodeDetections, nonMaxSuppression } from './faceGeometry.js';

/**
 * UltraFace "RFB-640" (Ultra-Light-Fast-Generic-Face-Detector-1MB, MIT licence).
 * The checksum guards against a truncated or tampered model file.
 */
const MODEL_PATH = new URL('../../../models/version-RFB-640.onnx', import.meta.url);
const MODEL_SHA256 = '8f4c659275977e7a3bfbfa339a9c769ad793df50f9c0baa8c14b11baa1646430';
const INPUT_WIDTH = 640;
const INPUT_HEIGHT = 480;
const NMS_IOU_THRESHOLD = 0.3;
/** Mid-grey padding normalises to roughly zero, matching the model's training input. */
const PAD_GREY = 127;

export interface Face extends Region {
  score: number;
}

export class FaceDetector {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async load(): Promise<FaceDetector> {
    const model = await readFile(MODEL_PATH);
    const digest = createHash('sha256').update(model).digest('hex');
    if (digest !== MODEL_SHA256) {
      throw new Error(`Face model checksum mismatch (got ${digest})`);
    }
    const session = await ort.InferenceSession.create(model, {
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 2,
      logSeverityLevel: 3,
    });
    const detector = new FaceDetector(session);
    // The first inference pays one-off allocation costs; do it before real jobs arrive.
    await detector.detect(
      { data: Buffer.alloc(64 * 48 * 3), width: 64, height: 48, channels: 3 },
      1,
    );
    return detector;
  }

  /** Returns faces in image pixel coordinates, largest first. */
  async detect(raster: Raster, minConfidence: number): Promise<Face[]> {
    // Letterbox instead of stretching, so faces keep the proportions the model was trained on.
    const scale = Math.min(INPUT_WIDTH / raster.width, INPUT_HEIGHT / raster.height);
    const resizedWidth = Math.max(1, Math.round(raster.width * scale));
    const resizedHeight = Math.max(1, Math.round(raster.height * scale));

    const { data } = await rasterToSharp(raster)
      .resize(resizedWidth, resizedHeight, { fit: 'fill' })
      .extend({
        right: INPUT_WIDTH - resizedWidth,
        bottom: INPUT_HEIGHT - resizedHeight,
        background: { r: PAD_GREY, g: PAD_GREY, b: PAD_GREY },
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const input = new ort.Tensor('float32', toNormalisedChw(data), [
      1,
      3,
      INPUT_HEIGHT,
      INPUT_WIDTH,
    ]);
    const output = await this.session.run({ input });
    const scores = output['scores']?.data as Float32Array;
    const boxes = output['boxes']?.data as Float32Array;

    const detections = nonMaxSuppression(
      decodeDetections(scores, boxes, minConfidence),
      NMS_IOU_THRESHOLD,
    );

    return detections
      .map((d) => {
        const left = Math.max(0, Math.round((d.x1 * INPUT_WIDTH) / scale));
        const top = Math.max(0, Math.round((d.y1 * INPUT_HEIGHT) / scale));
        const right = Math.min(raster.width, Math.round((d.x2 * INPUT_WIDTH) / scale));
        const bottom = Math.min(raster.height, Math.round((d.y2 * INPUT_HEIGHT) / scale));
        return { left, top, width: right - left, height: bottom - top, score: d.score };
      })
      .filter((face) => face.width > 0 && face.height > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);
  }
}

/** Interleaved RGB bytes to planar float32, scaled to roughly [-1, 1] as in training. */
function toNormalisedChw(rgb: Buffer): Float32Array {
  const plane = INPUT_WIDTH * INPUT_HEIGHT;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensor[i] = (rgb[i * 3]! - 127) / 128;
    tensor[plane + i] = (rgb[i * 3 + 1]! - 127) / 128;
    tensor[2 * plane + i] = (rgb[i * 3 + 2]! - 127) / 128;
  }
  return tensor;
}
