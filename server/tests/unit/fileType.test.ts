import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectImageFormat } from '../../src/lib/fileType.js';
import { readFixture } from '../helpers/fixtures.js';

/** Builds an ISO-BMFF 'ftyp' box with the given brands. */
function ftyp(major: string, compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const box = Buffer.alloc(size);
  box.writeUInt32BE(size, 0);
  box.write('ftyp', 4, 'ascii');
  box.write(major, 8, 'ascii');
  compatible.forEach((brand, i) => box.write(brand, 16 + i * 4, 'ascii'));
  return box;
}

describe('detectImageFormat', () => {
  it('recognises real JPEG, PNG and HEIC files', async () => {
    expect(detectImageFormat(await readFixture('portrait-koch.jpg'))).toBe('jpeg');
    expect(detectImageFormat(await readFixture('portrait-hansen.heic'))).toBe('heic');
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(detectImageFormat(png)).toBe('png');
  });

  it('accepts HEIF brands used by phones', () => {
    expect(detectImageFormat(ftyp('heic', ['mif1', 'heic']))).toBe('heic');
    expect(detectImageFormat(ftyp('mif1', ['heic']))).toBe('heic');
    expect(detectImageFormat(ftyp('msf1', ['hevc']))).toBe('heic');
  });

  it('rejects AVIF even though it shares the HEIF container', () => {
    expect(detectImageFormat(ftyp('avif', ['mif1', 'miaf']))).toBeNull();
    expect(detectImageFormat(ftyp('mif1', ['avif']))).toBeNull();
  });

  it('rejects other formats and disguised files regardless of their name', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    expect(detectImageFormat(gif)).toBeNull();
    expect(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageFormat(Buffer.from('just text, renamed to .jpg'))).toBeNull();
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });
});
