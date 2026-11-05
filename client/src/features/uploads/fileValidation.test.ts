import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateFile } from './fileValidation';

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// ftyp box: size 24, major brand "heic", minor 0, compatible "mif1", "heic"
const HEIC_HEADER = [0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')];

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function makeFile(name: string, header: number[], type: string, size = 2048): File {
  const bytes = new Uint8Array(size);
  bytes.set(header);
  return new File([bytes], name, { type });
}

describe('validateFile', () => {
  it('accepts JPEG, PNG and HEIC by content', async () => {
    expect(await validateFile(makeFile('a.jpg', JPEG_HEADER, 'image/jpeg'))).toEqual({
      ok: true,
      format: 'jpeg',
    });
    expect(await validateFile(makeFile('b.PNG', PNG_HEADER, 'image/png'))).toEqual({
      ok: true,
      format: 'png',
    });
    // Browsers usually report an empty type for HEIC.
    expect(await validateFile(makeFile('c.heic', HEIC_HEADER, ''))).toEqual({
      ok: true,
      format: 'heic',
    });
  });

  it('rejects other formats by extension or declared type', async () => {
    const gif = await validateFile(makeFile('anim.gif', ascii('GIF89a'), 'image/gif'));
    expect(gif).toEqual({
      ok: false,
      reasons: ['Unsupported format. Upload a JPG, PNG or HEIC image.'],
    });
    const webpNamedJpg = await validateFile(makeFile('x.jpg', JPEG_HEADER, 'image/webp'));
    expect(webpNamedJpg.ok).toBe(false);
  });

  it('rejects files whose contents do not match a supported format', async () => {
    const renamed = await validateFile(makeFile('notes.jpg', ascii('hello world'), 'image/jpeg'));
    expect(renamed).toEqual({
      ok: false,
      reasons: ['File contents are not a valid JPG, PNG or HEIC image.'],
    });
  });

  it('rejects empty and oversized files', async () => {
    const empty = await validateFile(new File([], 'empty.jpg', { type: 'image/jpeg' }));
    expect(empty).toEqual({ ok: false, reasons: ['The file is empty.'] });

    const huge = makeFile('huge.jpg', JPEG_HEADER, 'image/jpeg');
    Object.defineProperty(huge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    const result = await validateFile(huge);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reasons[0]).toMatch(/maximum is 25\.0 MB/);
  });
});
