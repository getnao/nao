import { readFile } from 'node:fs/promises';

import { documentMediaType, fileExtension, isBinaryDocument, toSafeFileName } from '@nao/shared/attachments';

import { env } from '../../env';
import { toReadableText } from '../file-text';
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

/** Where files a user attached to a message are kept, so uploads never mix with the agent's own exports. */
export const UPLOADS_DIRECTORY = 'uploads';

export const readUserFile = async (scope: StorageScope, relativePath: string): Promise<string> => {
	const key = scopedKey(scope, relativePath);
	return toReadableText(relativePathFromKey(scope, key), await readUserFileBytes(scope, relativePath));
};

/** The file as stored, for callers that hand it to something other than the conversation. */
export const readUserFileBytes = async (scope: StorageScope, relativePath: string): Promise<Buffer> => {
	const key = scopedKey(scope, relativePath);

	try {
		return await getStorage().read(key);
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
	assertWithinStorageSizeLimit(relativePath, data.byteLength);

	return getStorage().write(key, data, { contentType: guessContentType(relativePath) });
};

/** Stores a file produced elsewhere, such as a spreadsheet a sandbox built. */
export const writeUserFileBytes = async (
	scope: StorageScope,
	relativePath: string,
	data: Buffer,
): Promise<StorageObject> => {
	const key = scopedKey(scope, relativePath);
	assertWithinStorageSizeLimit(relativePath, data.byteLength);

	return getStorage().write(key, data, {
		contentType: documentMediaType(relativePath) ?? 'application/octet-stream',
	});
};

/** Stores a file another process left on disk, such as a result DuckDB wrote out. */
export const writeUserFileFromDisk = async (
	scope: StorageScope,
	relativePath: string,
	sourcePath: string,
): Promise<StorageObject> => {
	return writeUserFileBytes(scope, relativePath, await readFile(sourcePath));
};

export const statUserFile = async (scope: StorageScope, relativePath: string): Promise<StorageObject | null> => {
	return getStorage().stat(scopedKey(scope, relativePath));
};

/**
 * Stores a file a user attached to a message, under a name derived from the one their
 * browser reported. An upload never replaces an existing file: a name already taken gets
 * a numeric suffix instead.
 * @throws Error when the file type is not accepted or the file is over the size limit.
 */
export const saveUploadedFile = async (scope: StorageScope, fileName: string, data: Buffer): Promise<StorageObject> => {
	const safeName = toSafeFileName(fileName);
	if (!safeName) {
		throw new Error(`Cannot store a file named '${fileName}'`);
	}

	const contentType = documentMediaType(safeName);
	if (!contentType) {
		const extension = fileExtension(safeName);
		throw new Error(
			extension
				? `Files of type .${extension} cannot be uploaded`
				: 'Files without an extension cannot be uploaded',
		);
	}

	assertWithinStorageSizeLimit(safeName, data.byteLength);

	const directory = `${UPLOADS_DIRECTORY}/${new Date().toISOString().slice(0, 10)}`;
	const relativePath = await findUnusedPath(scope, directory, safeName);

	return getStorage().write(scopedKey(scope, relativePath), data, { contentType });
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

const MAX_NAME_ATTEMPTS = 50;

const findUnusedPath = async (scope: StorageScope, directory: string, fileName: string): Promise<string> => {
	const extension = fileExtension(fileName);
	const suffix = extension ? `.${extension}` : '';
	const stem = fileName.slice(0, fileName.length - suffix.length);

	for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
		const relativePath = `${directory}/${attempt === 1 ? fileName : `${stem}-${attempt}${suffix}`}`;
		if (!(await getStorage().exists(scopedKey(scope, relativePath)))) {
			return relativePath;
		}
	}

	return `${directory}/${stem}-${Date.now()}${suffix}`;
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

/**
 * Every write goes through `writeUserFile`, so this covers the whole instance. It is exported for
 * callers holding a file rather than its bytes, which can check the size without reading it in.
 */
export const assertWithinStorageSizeLimit = (relativePath: string, size: number): void => {
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

/** The `write` tool only ever produces text, so a binary extension would misdescribe the content. */
const guessContentType = (relativePath: string): string => {
	return isBinaryDocument(relativePath) ? 'text/plain' : (documentMediaType(relativePath) ?? 'text/plain');
};

const sortByName = <T extends { name: string }>(entries: T[]): T[] => {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
};
