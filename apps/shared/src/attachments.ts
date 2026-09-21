/**
 * A message can carry two kinds of attachment, because they reach the model very
 * differently. An image is there to be interpreted, so it is stored in the database and
 * inlined into the request. A document only ever reaches the model as a path in permanent
 * storage: inlining a spreadsheet or an export would swallow the context window.
 */

export const ALLOWED_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export type ImageUploadData = {
	mediaType: ImageMediaType;
	data: string;
};

/**
 * The media type nao stores each accepted document extension under. Browsers disagree on
 * the type of several of these and report none at all for others, so the extension is the
 * only part of the upload we trust.
 */
export const DOCUMENT_MEDIA_TYPES = {
	csv: 'text/csv',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	html: 'text/html',
	json: 'application/json',
	jsonl: 'application/x-ndjson',
	md: 'text/markdown',
	parquet: 'application/vnd.apache.parquet',
	pdf: 'application/pdf',
	sql: 'application/sql',
	tsv: 'text/tab-separated-values',
	txt: 'text/plain',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	xml: 'application/xml',
	yaml: 'application/yaml',
	yml: 'application/yaml',
} as const;

export type DocumentExtension = keyof typeof DOCUMENT_MEDIA_TYPES;

/** Every accepted extension, for callers that need them as a closed list rather than a lookup. */
export const DOCUMENT_EXTENSIONS = Object.keys(DOCUMENT_MEDIA_TYPES) as [DocumentExtension, ...DocumentExtension[]];

/** Accepted documents whose bytes are not text, so their contents can never be read into a conversation. */
export const BINARY_DOCUMENT_EXTENSIONS = [
	'docx',
	'parquet',
	'pdf',
	'xls',
	'xlsx',
] as const satisfies readonly DocumentExtension[];

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGE_SIZE_MB = 5;

/** `accept` value for a file input taking every kind of attachment. */
export const ATTACHMENT_ACCEPT = [
	...ALLOWED_IMAGE_MEDIA_TYPES,
	...Object.keys(DOCUMENT_MEDIA_TYPES).map((extension) => `.${extension}`),
].join(',');

export const isImageMediaType = (mediaType: string): mediaType is ImageMediaType => {
	return (ALLOWED_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
};

/** The accepted extension of a file name, or undefined when nao does not handle that kind of file. */
export const documentExtension = (fileName: string): DocumentExtension | undefined => {
	const extension = fileExtension(fileName);
	return Object.hasOwn(DOCUMENT_MEDIA_TYPES, extension) ? (extension as DocumentExtension) : undefined;
};

/** The media type to store a document under, or undefined when its extension is not accepted. */
export const documentMediaType = (fileName: string): string | undefined => {
	const extension = documentExtension(fileName);
	return extension && DOCUMENT_MEDIA_TYPES[extension];
};

export const isBinaryDocument = (fileName: string): boolean => {
	return (BINARY_DOCUMENT_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
};

/** Lowercased extension without its dot, empty when the name has none. */
export const fileExtension = (fileName: string): string => {
	const lastDot = fileName.lastIndexOf('.');
	return lastDot <= 0 ? '' : fileName.slice(lastDot + 1).toLowerCase();
};

const MAX_FILE_NAME_LENGTH = 120;

/**
 * Reduces a name that came from a browser to something usable as a single path segment.
 * Returns undefined when nothing usable is left.
 */
export const toSafeFileName = (fileName: string): string | undefined => {
	const baseName = fileName.split(/[\\/]/).pop() ?? '';
	const cleaned = baseName
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '');

	if (cleaned === '') {
		return undefined;
	}

	return cleaned.length > MAX_FILE_NAME_LENGTH ? truncateKeepingExtension(cleaned) : cleaned;
};

const truncateKeepingExtension = (fileName: string): string => {
	const extension = fileExtension(fileName);
	const suffix = extension ? `.${extension}` : '';
	const stem = fileName.slice(0, fileName.length - suffix.length);
	return `${stem.slice(0, MAX_FILE_NAME_LENGTH - suffix.length)}${suffix}`;
};
