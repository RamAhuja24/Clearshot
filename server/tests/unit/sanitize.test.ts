import { describe, expect, it } from 'vitest';
import { decodeMultipartFilename, sanitizeFilename } from '../../src/lib/sanitize.js';

describe('sanitizeFilename', () => {
  it('keeps ordinary and Unicode names intact', () => {
    expect(sanitizeFilename('My photo.jpg')).toBe('My photo.jpg');
    expect(sanitizeFilename('Víctor 日本.heic')).toBe('Víctor 日本.heic');
  });

  it('strips directories, control characters and unsafe characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\pic.png')).toBe('pic.png');
    expect(sanitizeFilename('a\u0000b\u001fc<>:"|?*.jpg')).toBe('abc.jpg');
    expect(sanitizeFilename('...hidden.jpg')).toBe('hidden.jpg');
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeFilename(undefined)).toBe('image');
    expect(sanitizeFilename('   ')).toBe('image');
    expect(sanitizeFilename('///')).toBe('image');
  });

  it('caps the length while keeping the extension', () => {
    const result = sanitizeFilename(`${'x'.repeat(500)}.jpeg`);
    expect(result).toHaveLength(200);
    expect(result.endsWith('.jpeg')).toBe(true);
  });
});

describe('decodeMultipartFilename', () => {
  it('repairs UTF-8 names that were decoded as latin1', () => {
    const garbled = Buffer.from('café.jpg', 'utf8').toString('latin1');
    expect(decodeMultipartFilename(garbled)).toBe('café.jpg');
  });

  it('leaves names alone when re-decoding would corrupt them', () => {
    expect(decodeMultipartFilename('plain.jpg')).toBe('plain.jpg');
    expect(decodeMultipartFilename('日本.jpg')).toBe('日本.jpg');
  });
});
