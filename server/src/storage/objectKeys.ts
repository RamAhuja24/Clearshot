import { EXTENSION_BY_FORMAT, type ImageFormat } from '../lib/fileType.js';

// Keys are derived only from server-generated ids, never from user input.
// Grouping by image id keeps every object of one image under a single prefix.
export const objectKeys = {
  original: (imageId: string, format: ImageFormat) =>
    `images/${imageId}/original.${EXTENSION_BY_FORMAT[format]}`,
  thumbnail: (imageId: string) => `images/${imageId}/thumbnail.webp`,
  converted: (imageId: string) => `images/${imageId}/converted.jpg`,
};
