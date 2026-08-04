import { env } from '../../env';
import { getStorage, isStorageEnabled } from '.';
import { relativePathFromKey, sanitizeRelativePath, scopedKey, scopeRoot } from './keys';
import { LocalStorageProvider } from './local.provider';
import type { StorageObject, StorageScope } from './types';

export interface StorageDirectoryEntry {
	name: string;
	/** Path inside the user's space, e.g. `reports/q3.csv`. */
	relativePath: string;
	type: 'file' | 'directory';
	size?: number;
	/** Immediate children, for directories. */
	itemCount?: number;
}

export const readUserFile = async (scope: StorageScope, relativePath: string): Promise<string> => {
	const key = scopedKey(scope, relativePath);

	try {
		return (await getStorage().read(key)).toString('utf-8');
	} catch (error) {
		if (isMissing(error)) {
			throw new Error(`No such file in permanent storage: ${relativePathFromKey(scope, key)}`);
		}
		throw error;
	}
};

export const writeUserFile = async (
	scope: StorageScope,
	relativePath: string,
	content: string,
): Promise<StorageObject> => {
	const key = scopedKey(scope, relativePath);
	const data = Buffer.from(content, 'utf-8');
	assertWithinSizeLimit(relativePath, data.byteLength);

	return getStorage().write(key, data, { contentType: guessContentType(relativePath) });
};

/**
 * Turns the flat key space into one directory level. Directories only exist as
 * a shared prefix of the keys below them, so an empty one is never listed.
 */
export const listUserDirectory = async (scope: StorageScope, relativeDir: string): Promise<StorageDirectoryEntry[]> => {
	const base = relativeDir === '' ? '' : `${sanitizeRelativePath(relativeDir)}/`;
	const objects = await getStorage().list(relativeDir === '' ? scopeRoot(scope) : scopedKey(scope, relativeDir));

	const files: StorageDirectoryEntry[] = [];
	const directoryChildren = new Map<string, Set<string>>();

	for (const object of objects) {
		const relativePath = relativePathFromKey(scope, object.key);
		if (!relativePath.startsWith(base)) {
			continue;
		}

		const [name, ...rest] = relativePath.slice(base.length).split('/');
		if (!name) {
			continue;
		}

		if (rest.length === 0) {
			files.push({ name, relativePath, type: 'file', size: object.size });
			continue;
		}

		const children = directoryChildren.get(name) ?? new Set<string>();
		children.add(rest[0]!);
		directoryChildren.set(name, children);
	}

	const directories = [...directoryChildren].map(([name, children]) => ({
		name,
		relativePath: `${base}${name}`,
		type: 'directory' as const,
		itemCount: children.size,
	}));

	return [...sortByName(directories), ...sortByName(files)];
};

/** Every file in the user's space whose path satisfies `matches`. */
export const findUserFiles = async (
	scope: StorageScope,
	matches: (relativePath: string) => boolean,
): Promise<StorageObject[]> => {
	const objects = await getStorage().list(scopeRoot(scope));
	return objects.filter((object) => matches(relativePathFromKey(scope, object.key)));
};

/** Searching inside files needs a real filesystem, which only the local backend has. */
export const canGrepUserFiles = (): boolean => {
	return isStorageEnabled() && getStorage() instanceof LocalStorageProvider;
};

/**
 * Absolute directory to walk for tools that need a real filesystem (content search).
 * @throws Error when the backend is not `local`.
 */
export const grepRootForUser = (scope: StorageScope, relativeDir = ''): string => {
	const storage = getStorage();

	if (!(storage instanceof LocalStorageProvider)) {
		throw new Error(
			'Searching file contents in permanent storage requires the `local` storage backend. On the `s3` backend, use search to find files by name and read them instead.',
		);
	}

	return storage.toFilePath(relativeDir === '' ? scopeRoot(scope) : scopedKey(scope, relativeDir));
};

const CONTENT_TYPES: Record<string, string> = {
	csv: 'text/csv',
	html: 'text/html',
	json: 'application/json',
	md: 'text/markdown',
	sql: 'application/sql',
	tsv: 'text/tab-separated-values',
	txt: 'text/plain',
	xml: 'application/xml',
	yaml: 'application/yaml',
	yml: 'application/yaml',
};

/** Both backends report a missing object their own way. */
const isMissing = (error: unknown): boolean => {
	const candidate = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
	return (
		candidate?.code === 'ENOENT' ||
		candidate?.name === 'NoSuchKey' ||
		candidate?.name === 'NotFound' ||
		candidate?.$metadata?.httpStatusCode === 404
	);
};

/** Every write goes through `writeUserFile`, so this covers the whole instance. */
const assertWithinSizeLimit = (relativePath: string, size: number): void => {
	if (size <= env.NAO_STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024) {
		return;
	}

	throw new Error(
		`File too large: ${relativePath} is ${formatMegabytes(size)} MB, above the ${env.NAO_STORAGE_MAX_FILE_SIZE_MB} MB limit for permanent storage. Write less data, or ask an admin to raise NAO_STORAGE_MAX_FILE_SIZE_MB.`,
	);
};

const formatMegabytes = (bytes: number): string => {
	return (bytes / (1024 * 1024)).toFixed(1);
};

const guessContentType = (relativePath: string): string => {
	const extension = relativePath.split('.').pop()?.toLowerCase() ?? '';
	return CONTENT_TYPES[extension] ?? 'text/plain';
};

const sortByName = <T extends { name: string }>(entries: T[]): T[] => {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
};
