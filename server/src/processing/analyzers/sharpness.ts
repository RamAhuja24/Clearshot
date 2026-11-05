import { rasterToSharp, type Raster, type Region } from '../raster.js';

/** Images are downscaled to this size first, so scores are comparable across resolutions. */
const ANALYSIS_MAX_SIDE = 512;

/**
 * Sharpness as the variance of the Laplacian. In-focus images have many strong
 * edges and score high; blurry ones score low. Pass a region (the face) to ignore
 * deliberately soft backgrounds such as portrait-mode bokeh.
 */
export async function measureSharpness(raster: Raster, region?: Region): Promise<number> {
  let pipeline = rasterToSharp(raster);
  if (region) pipeline = pipeline.extract(region);

  const { data, info } = await pipeline
    .resize(ANALYSIS_MAX_SIDE, ANALYSIS_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return laplacianVariance(data, info.width, info.height);
}

/** Variance of the 4-neighbour Laplacian over a single-channel image. */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumOfSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian =
        gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      sum += laplacian;
      sumOfSquares += laplacian * laplacian;
      count++;
    }
  }

  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}
