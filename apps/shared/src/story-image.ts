import type { StoryApp, StoryQueryResult } from './story-app';

type StoryImageScheme = 'gs' | 's3' | 'https';

export interface StoryImageLocation {
	scheme: StoryImageScheme;
	host: string;
	path: string;
}

export type StoryImageResult = { dataUri: string } | { error: string };

export const MAX_STORY_IMAGE_BYTES = 5 * 1024 * 1024;

export const MAX_STORY_IMAGE_ALLOWED_SOURCES = 50;

export const MAX_STORY_IMAGE_SOURCE_LENGTH = 2048;

export const MAX_STORY_IMAGES_PER_REQUEST = 10;

/** Images a downloaded story embeds, so the page stays under the snapshot size the server accepts. */
export const MAX_STORY_EXPORT_IMAGE_BYTES = 12 * 1024 * 1024;

export const STORY_IMAGE_SOURCE_FORMAT_MESSAGE =
	'Use https://host, gs://bucket or s3://bucket, optionally followed by a path.';

/** Image sources travel in a GET query string, so a batch stays under the URL length the server accepts. */
const MAX_STORY_IMAGE_SOURCE_CHARS_PER_REQUEST = 2048;

/** Most links a scan finds are not images, so the scan stops before a story full of links costs much. */
const MAX_STORY_IMAGE_CANDIDATES = 200;

const STORY_IMAGE_MEDIA_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
};

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const BUCKET_SOURCE_PATTERN = /^(gs|s3):\/\/([^/?#]+)(\/[^?#]*)?$/i;
const SOURCE_CANDIDATE_PATTERN = /\b(?:gs|s3|https):\/\/[^\s"'`<>()[\]{}\\^|]+/gi;
const QUOTED_SOURCE_PATTERN = /(["'`])((?:gs|s3):\/\/[^"'`\n]+|https:\/\/[^"'`\s]+)\1/gi;
const WHOLE_HTTPS_SOURCE_PATTERN = /^https:\/\/\S+$/i;
const LINK_ATTRIBUTE_PATTERN = /\bhref\s*[=:]\s*\{?\s*(["'`])[^"'`\n]*\1/gi;
const DIRECT_IMAGE_SOURCE_PATTERN =
	/(?:<Image\b[^>]*?\bsrc=\{?\s*|\.image\(\s*)(["'`])((?:gs|s3|https):\/\/[^"'`\n]+)\1/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const ENCODED_SEPARATOR_PATTERN = /%2f|%5c/i;
const IMAGE_CALL_PATTERN = /\bImage\b|\.image\(/;
const TEMPLATE_EXPRESSION_PATTERN = /\$\{([^}]*)\}/;
const ROW_FIELD_PATTERN = /^\s*[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*\s*$/;
const ROW_FIELD_SEPARATOR = /\??\./;

type StoryRow = Record<string, unknown>;

/** Data and blob URLs already live in the frame: the story shows them without asking the host. */
export function isInlineStoryImage(src: string): boolean {
	return /^(data|blob):/i.test(src);
}

export function normalizeStoryImageAllowedSource(raw: string): string | null {
	const location = parseLocation(raw.trim(), { isAllowlistEntry: true });
	return location ? `${location.scheme}://${location.host}${location.path}` : null;
}

export function parseStoryImageSource(src: string): StoryImageLocation | null {
	return parseLocation(src.trim(), { isAllowlistEntry: false });
}

/** An entry covers its host or bucket, or only the objects below its path when it has one. */
export function isAllowedStoryImageSource(src: string, allowedSources: string[]): boolean {
	const location = parseStoryImageSource(src);
	return location !== null && isCoveredBy(location, allowedSources);
}

/** Whether an allowlist entry sits inside one of the broader entries, as a bucket inside the operator's buckets. */
export function isStoryImageSourceWithin(entry: string, broaderSources: string[]): boolean {
	const location = parseLocation(entry.trim(), { isAllowlistEntry: true });
	return location !== null && isCoveredBy(location, broaderSources);
}

export function storyAppCode(app: StoryApp): string[] {
	return app.kind === 'html' ? [app.bundle, app.pageShell] : [app.bundle];
}

/**
 * Most links in query rows are not images, so rows only count when the code shows images. A template link is filled
 * from every query's rows, since the scan cannot tell which query it reads: some filled links are never shown.
 */
export function findStoryImageSources(
	code: string[],
	queries: Record<string, StoryQueryResult>,
	{
		isWanted = () => true,
		fillsTemplates = true,
	}: { isWanted?: (src: string) => boolean; fillsTemplates?: boolean } = {},
): string[] {
	const showsImages = code.some((text) => IMAGE_CALL_PATTERN.test(text));
	const rows = showsImages && fillsTemplates ? collectRows(queries) : [];
	const rowValues = showsImages ? collectStrings(queries) : [];
	const candidates = [...code.flatMap((text) => linksInCode(text, rows)), ...rowValues.flatMap(linksInValue)];
	const sources = new Set<string>();
	for (const candidate of candidates) {
		if (candidate.length <= MAX_STORY_IMAGE_SOURCE_LENGTH && isWanted(candidate)) {
			sources.add(candidate);
		}
		if (sources.size >= MAX_STORY_IMAGE_CANDIDATES) {
			break;
		}
	}
	return [...sources];
}

/** Links written straight into `<Image src>` or `.image()`, which show an image whatever their file name. */
export function findDirectStoryImageSources(code: string[]): string[] {
	const sources = code.flatMap((text) => [...text.matchAll(DIRECT_IMAGE_SOURCE_PATTERN)].map((match) => match[2]));
	return [...new Set(sources.filter(isLiteralImageSource))];
}

/** Template links that show an image, like `gs://bucket/${row.key}.png`, whose rows are only known when the story runs. */
export function findStoryImageTemplates(code: string[]): string[] {
	const direct = code.flatMap((text) => [...text.matchAll(DIRECT_IMAGE_SOURCE_PATTERN)].map((match) => match[2]));
	const named = code.flatMap(templatesInCode).filter((template) => storyImageMediaTypeFromPath(template) !== null);
	return [...new Set([...direct, ...named])].filter((source) => source.includes('${'));
}

/** Blocked whatever its rows hold: no allowed source sits inside or around the folder its fixed start names. */
export function isStoryImageTemplateBlocked(template: string, allowedSources: string[]): boolean {
	const fixedStart = template.slice(0, template.indexOf('${'));
	const folder = normalizeStoryImageAllowedSource(fixedStart.slice(0, fixedStart.lastIndexOf('/') + 1));
	if (!folder) {
		return false;
	}
	return (
		!isStoryImageSourceWithin(folder, allowedSources) &&
		!allowedSources.some((entry) => isStoryImageSourceWithin(entry, [folder]))
	);
}

/** Reads the images batch by batch, keeps what loaded and stops once the export budget is spent. */
export async function readEmbeddableStoryImages(
	sources: string[],
	readBatch: (batch: string[]) => Promise<Record<string, StoryImageResult>>,
): Promise<Record<string, string>> {
	const images: Record<string, string> = {};
	let totalBytes = 0;
	for (const batch of chunkStoryImageSources(sources)) {
		const results = await readBatch(batch).catch(() => ({}));
		for (const [src, result] of Object.entries(results)) {
			if (!('dataUri' in result)) {
				continue;
			}
			totalBytes += result.dataUri.length;
			if (totalBytes > MAX_STORY_EXPORT_IMAGE_BYTES) {
				return images;
			}
			images[src] = result.dataUri;
		}
	}
	return images;
}

export function storyImageMediaTypeFromPath(path: string): string | null {
	const extension = path.split('?')[0].split('.').pop()?.toLowerCase();
	return extension ? (STORY_IMAGE_MEDIA_TYPES[extension] ?? null) : null;
}

export function isStoryImageMediaType(mediaType: string): boolean {
	return Object.values(STORY_IMAGE_MEDIA_TYPES).includes(mediaType);
}

function isCoveredBy(location: StoryImageLocation, entries: string[]): boolean {
	return entries.some((entry) => {
		const allowed = parseLocation(entry, { isAllowlistEntry: true });
		return (
			allowed !== null &&
			allowed.scheme === location.scheme &&
			allowed.host === location.host &&
			isBelowPath(location.path, allowed.path)
		);
	});
}

function linksInText(text: string): string[] {
	return [...text.matchAll(SOURCE_CANDIDATE_PATTERN)]
		.map((match) => match[0].replace(TRAILING_PUNCTUATION, ''))
		.filter((candidate) => parseStoryImageSource(candidate) !== null);
}

/** A link's `href` shows no image, and image paths often hold spaces or brackets, so a quoted link is kept whole. */
function linksInCode(text: string, rows: StoryRow[]): string[] {
	const quoted: string[] = [];
	const unquoted = text
		.replace(LINK_ATTRIBUTE_PATTERN, ' ')
		.replace(QUOTED_SOURCE_PATTERN, (_match, quote: string, source: string) => {
			quoted.push(...(quote === '`' ? fillTemplateFromRows(source, rows) : [source]));
			return ' ';
		});
	return [...quoted.filter(isLiteralImageSource), ...linksInText(unquoted)];
}

function templatesInCode(text: string): string[] {
	return [...text.replace(LINK_ATTRIBUTE_PATTERN, ' ').matchAll(QUOTED_SOURCE_PATTERN)]
		.filter(([, quote, source]) => quote === '`' && source.includes('${'))
		.map(([, , source]) => source);
}

/**
 * A template literal like `gs://bucket/${row.key}.png` names one object per row, read from the row's `key` column.
 * Property names survive the bundler's renaming; any other expression only resolves when the story runs.
 */
function fillTemplateFromRows(template: string, rows: StoryRow[]): string[] {
	const parts = template.split(TEMPLATE_EXPRESSION_PATTERN);
	if (parts.length === 1) {
		return [template];
	}
	const literals = parts.filter((_part, index) => index % 2 === 0);
	const fields = parts.filter((_part, index) => index % 2 === 1).map(rowField);
	if (!fields.every((field): field is string => field !== null)) {
		return [];
	}
	return rows.flatMap((row) => {
		const values = fields.map((field) => row[field]);
		if (!values.every(isTemplateValue)) {
			return [];
		}
		return [literals.reduce((source, literal, index) => `${source}${values[index - 1]}${literal}`)];
	});
}

function rowField(expression: string): string | null {
	return ROW_FIELD_PATTERN.test(expression) ? (expression.trim().split(ROW_FIELD_SEPARATOR).at(-1) ?? null) : null;
}

function isTemplateValue(value: unknown): value is string | number | bigint {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
}

/** A template literal left unresolved names no real object until it runs. */
function isLiteralImageSource(source: string): boolean {
	return !source.includes('${') && parseStoryImageSource(source) !== null;
}

/** Image paths often hold spaces or brackets, so a row value that is a whole link is kept as it is. */
function linksInValue(value: string): string[] {
	const whole = value.trim();
	const isWholeLink = BUCKET_SOURCE_PATTERN.test(whole) || WHOLE_HTTPS_SOURCE_PATTERN.test(whole);
	return isWholeLink && parseStoryImageSource(whole) ? [whole] : linksInText(value);
}

function collectRows(queries: Record<string, StoryQueryResult>): StoryRow[] {
	return Object.values(queries).flatMap((result) => result.data.filter(isRow));
}

function isRow(value: unknown): value is StoryRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	if (value !== null && typeof value === 'object') {
		return Object.values(value).flatMap(collectStrings);
	}
	return [];
}

function chunkStoryImageSources(sources: string[]): string[][] {
	const chunks: string[][] = [];
	let chunkChars = 0;
	for (const source of sources) {
		const current = chunks.at(-1);
		if (
			!current ||
			current.length >= MAX_STORY_IMAGES_PER_REQUEST ||
			chunkChars + source.length > MAX_STORY_IMAGE_SOURCE_CHARS_PER_REQUEST
		) {
			chunks.push([source]);
			chunkChars = source.length;
			continue;
		}
		current.push(source);
		chunkChars += source.length;
	}
	return chunks;
}

function parseLocation(raw: string, { isAllowlistEntry }: { isAllowlistEntry: boolean }): StoryImageLocation | null {
	const bucket = raw.match(BUCKET_SOURCE_PATTERN);
	if (bucket) {
		const scheme = bucket[1].toLowerCase() as 'gs' | 's3';
		return parseBucketLocation(scheme, bucket[2], bucket[3] ?? '', isAllowlistEntry);
	}
	return parseHttpsLocation(raw, isAllowlistEntry);
}

/** Object keys are flat names, but `.` and `..` segments are refused so no client can read them as a way up. */
function parseBucketLocation(
	scheme: 'gs' | 's3',
	rawBucket: string,
	path: string,
	isAllowlistEntry: boolean,
): StoryImageLocation | null {
	const host = rawBucket.toLowerCase();
	const hasDotSegment = path
		.split('/')
		.slice(1)
		.some((segment) => segment === '.' || segment === '..');
	const hasKey = path.length > 1;
	if (!BUCKET_PATTERN.test(host) || hasDotSegment || (!isAllowlistEntry && !hasKey)) {
		return null;
	}
	return { scheme, host, path: path === '/' ? '' : path };
}

/** An encoded `/` or `\` would pass the prefix check here, then be decoded into a way up by many servers. */
function parseHttpsLocation(raw: string, isAllowlistEntry: boolean): StoryImageLocation | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	const isPlainHttps = url.protocol === 'https:' && !url.username && !url.password && url.hostname !== '';
	if (!isPlainHttps || ENCODED_SEPARATOR_PATTERN.test(url.pathname)) {
		return null;
	}
	if (isAllowlistEntry ? url.search || url.hash : url.pathname === '/') {
		return null;
	}
	return { scheme: 'https', host: url.host.toLowerCase(), path: url.pathname === '/' ? '' : url.pathname };
}

function isBelowPath(path: string, prefix: string): boolean {
	if (prefix === '') {
		return true;
	}
	const folder = prefix.endsWith('/') ? prefix : `${prefix}/`;
	return path === prefix || path.startsWith(folder);
}
