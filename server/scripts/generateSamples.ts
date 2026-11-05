/**
 * Writes a demo set to <repo>/samples: one file per validation outcome, derived from
 * the public-domain fixtures in tests/fixtures. Upload them in order to see each rule.
 *
 *   npm run samples -w server
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));
const outputDir = fileURLToPath(new URL('../../samples/', import.meta.url));
const output = (name: string) => `${outputDir}${name}`;

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const koch = await readFile(fixture('portrait-koch.jpg'));
const landscape = await readFile(fixture('landscape-grand-canyon.jpg'));

const samples: Array<[string, () => Promise<Buffer | string>]> = [
  ['01-accept-portrait.jpg', async () => koch],
  ['02-accept-portrait.png', () => sharp(fixture('portrait-wiseman.jpg')).png().toBuffer()],
  ['03-accept-portrait.heic', async () => readFile(fixture('portrait-hansen.heic'))],
  // Byte-for-byte identical to sample 01.
  ['04-reject-duplicate.jpg', async () => koch],
  // Re-encoded, resized and slightly cropped copy of sample 01.
  [
    '05-reject-too-similar.jpg',
    () =>
      sharp(koch)
        .extract({ left: 40, top: 40, width: 1015, height: 1380 })
        .resize(900)
        .jpeg({ quality: 70 })
        .toBuffer(),
  ],
  ['06-reject-blurry.jpg', () => sharp(fixture('portrait-glover.jpg')).blur(3).jpeg().toBuffer()],
  // Mirrored so it is not also flagged as similar to sample 01.
  [
    '07-reject-low-resolution.jpg',
    () => sharp(koch).flop().resize(300).jpeg({ quality: 70 }).toBuffer(),
  ],
  ['08-reject-multiple-faces.jpg', async () => readFile(fixture('group-artemis-crew.jpg'))],
  [
    '09-reject-face-too-small.jpg',
    async () =>
      sharp(landscape)
        .resize(3000, 1600, { fit: 'fill' })
        .composite([
          {
            input: await sharp(fixture('portrait-hansen.jpg')).flop().resize(260).toBuffer(),
            left: 1400,
            top: 700,
          },
        ])
        .jpeg({ quality: 85 })
        .toBuffer(),
  ],
  ['10-reject-no-face.jpg', async () => landscape],
  ['11-blocked-unsupported-format.gif', () => sharp(koch).resize(600).gif().toBuffer()],
  ['12-blocked-not-an-image.jpg', async () => 'This is a text file pretending to be a JPEG.\n'],
];

for (const [name, build] of samples) {
  await writeFile(output(name), await build());
}

console.log(`Wrote ${samples.length} samples to ${outputDir}`);
