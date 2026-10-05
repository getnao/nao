/** Limits on the brand sources (image, PDF, ZIP) a theme can be generated from. */

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Images the model sees in total, across every source. */
export const MAX_SOURCE_IMAGES = 4;
export const SOURCE_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SourceImageMediaType = (typeof SOURCE_IMAGE_MEDIA_TYPES)[number];
