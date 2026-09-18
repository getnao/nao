const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 6;
const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ALLOWED_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'css', 'json', 'md']);

export class InvalidStoryFilePathError extends Error {}

export function normalizeStoryFilePath(raw: string): string {
	const slashed = raw.trim().replace(/\\/g, '/');
	if (slashed.startsWith('/')) {
		throw new InvalidStoryFilePathError('File paths are relative to the story root; do not start with "/".');
	}
	const trimmed = slashed.replace(/^\.\//, '');
	if (!trimmed) {
		throw new InvalidStoryFilePathError('File path is empty.');
	}
	if (trimmed.length > MAX_PATH_LENGTH) {
		throw new InvalidStoryFilePathError(`File path is longer than ${MAX_PATH_LENGTH} characters.`);
	}
	const segments = trimmed.split('/');
	if (segments.length > MAX_DEPTH) {
		throw new InvalidStoryFilePathError(`File path is nested deeper than ${MAX_DEPTH} levels.`);
	}
	for (const segment of segments) {
		if (segment === '..' || segment === '.' || !SEGMENT.test(segment)) {
			throw new InvalidStoryFilePathError(`"${segment}" is not a valid path segment.`);
		}
	}
	const extension = segments.at(-1)?.split('.').pop()?.toLowerCase() ?? '';
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		throw new InvalidStoryFilePathError(
			`Unsupported file type ".${extension}". Allowed: ${[...ALLOWED_EXTENSIONS].map((e) => `.${e}`).join(', ')}.`,
		);
	}
	return segments.join('/');
}
