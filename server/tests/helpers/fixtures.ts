import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export const readFixture = (name: string) => readFile(fixturePath(name));

/** Re-encoded, resized, slightly cropped copy: visually the same picture, different bytes. */
export async function nearDuplicateOf(name: string): Promise<Buffer> {
  const source = sharp(await readFixture(name));
  const { width = 0, height = 0 } = await source.metadata();
  return source
    .extract({ left: 30, top: 30, width: width - 60, height: height - 60 })
    .resize(Math.round(width * 0.8))
    .jpeg({ quality: 70 })
    .toBuffer();
}
