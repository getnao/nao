/** Limits on the brand sources (image, PDF, ZIP, document) a theme can be generated from, and how documents are read. */

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_PROMPT_CHARACTERS = 24_000;
/** Images the model sees in total, across every source. */
export const MAX_SOURCE_IMAGES = 4;
export const MAX_THEME_INSTRUCTIONS_LENGTH = 2000;
export const SOURCE_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type SourceImageMediaType = (typeof SOURCE_IMAGE_MEDIA_TYPES)[number];

const LINE_BREAKS = /\r\n?/g;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const MARKDOWN_DATA_IMAGES = /!\[[^\]]*\]\(\s*data:[^)]*\)[ \t]*/g;
const HTML_DATA_IMAGES = /<img\b[^>]*\bsrc\s*=\s*["']data:[^"']*["'][^>]*>[ \t]*/gi;
const DATA_URIS = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g;
const TRAILING_SPACES = /[ \t]+$/gm;
const SPACE_RUNS = /[ \t]{2,}/g;
const BLANK_LINE_RUNS = /\n{3,}/g;

/** Drops what spends the prompt budget without saying anything: embedded images, comments and layout padding. */
export function cleanDocumentText(text: string): string {
	return text
		.replace(LINE_BREAKS, '\n')
		.replace(HTML_COMMENTS, '')
		.replace(MARKDOWN_DATA_IMAGES, '')
		.replace(HTML_DATA_IMAGES, '')
		.replace(DATA_URIS, '')
		.replace(TRAILING_SPACES, '')
		.replace(SPACE_RUNS, ' ')
		.replace(BLANK_LINE_RUNS, '\n\n')
		.trim();
}
