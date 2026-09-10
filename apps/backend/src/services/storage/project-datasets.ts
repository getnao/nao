import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { documentMediaType } from '@nao/shared/attachments';

import { toReadableText } from '../file-text';
import { getStorage, isStorageEnabled, STORAGE_DISABLED_MESSAGE } from '.';
import type { StorageFileAccess } from './file-access';
import { projectDatasetKey, projectDatasetRelativePathFromKey, projectDatasetRoot, sanitizeRelativePath } from './keys';
import { LocalStorageProvider } from './local.provider';
import type { StorageObject } from './types';
import type { StorageDirectoryEntry } from './user-files';

export const readProjectDataset = async (projectId: string, relativePath: string): Promise<string> => {
	return toReadableText(relativePath, await readProjectDatasetBytes(projectId, relativePath));
};

export const readProjectDatasetBytes = async (projectId: string, relativePath: string): Promise<Buffer> => {
	const key = projectDatasetKey(projectId, relativePath);
	try {
		return await getStorage().read(key);
	} catch (error) {
		if (isMissing(error)) {
			throw new Error(`No such project dataset file: ${projectDatasetRelativePathFromKey(projectId, key)}`);
		}
		throw error;
	}
};

export const writeProjectDataset = async (
	projectId: string,
	relativePath: string,
	data: string | Buffer,
): Promise<StorageObject> => {
	const bytes = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
	return getStorage().write(projectDatasetKey(projectId, relativePath), bytes, {
		contentType: documentMediaType(relativePath) ?? 'application/octet-stream',
	});
};

export const statProjectDataset = async (projectId: string, relativePath: string): Promise<StorageObject | null> => {
	return getStorage().stat(projectDatasetKey(projectId, relativePath));
};

export const canGrepProjectDatasets = (): boolean => {
	return isStorageEnabled() && getStorage() instanceof LocalStorageProvider;
};

export const grepRootForProjectDatasets = (projectId: string, relativePath = ''): string => {
	const storage = getStorage();
	if (!(storage instanceof LocalStorageProvider)) {
		throw new Error('Searching generated dataset contents requires the `local` storage backend.');
	}
	return storage.toFilePath(
		relativePath ? projectDatasetKey(projectId, relativePath) : projectDatasetRoot(projectId),
	);
};

export const findProjectDatasetFiles = async (
	projectId: string,
	predicate: (relativePath: string) => boolean,
): Promise<StorageObject[]> => {
	const objects = await getStorage().list(projectDatasetRoot(projectId));
	return objects.filter((object) => predicate(projectDatasetRelativePathFromKey(projectId, object.key)));
};

export const listProjectDatasetDirectory = async (
	projectId: string,
	relativeDir: string,
): Promise<StorageDirectoryEntry[]> => {
	const base = relativeDir === '' ? '' : `${sanitizeRelativePath(relativeDir)}/`;
	const objects = await getStorage().list(
		relativeDir === '' ? projectDatasetRoot(projectId) : projectDatasetKey(projectId, relativeDir),
	);

	const files: StorageDirectoryEntry[] = [];
	const directoryChildren = new Map<string, Set<string>>();

	for (const object of objects) {
		const relativePath = projectDatasetRelativePathFromKey(projectId, object.key);
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

export const openProjectDatasetFiles = async (
	projectId: string,
	relativePaths: string[],
): Promise<StorageFileAccess> => {
	if (!isStorageEnabled()) {
		throw new Error(STORAGE_DISABLED_MESSAGE);
	}

	const storage = getStorage();
	if (storage instanceof LocalStorageProvider) {
		await assertFilesExist(projectId, relativePaths);
		return {
			realPathOf: (relativePath) => storage.toFilePath(projectDatasetKey(projectId, relativePath)),
			directory: storage.toFilePath(projectDatasetRoot(projectId)),
			release: async () => {},
		};
	}

	return stageDatasetFiles(projectId, relativePaths);
};

const stageDatasetFiles = async (projectId: string, relativePaths: string[]): Promise<StorageFileAccess> => {
	const directory = await mkdtemp(join(tmpdir(), 'nao-datasets-'));
	const stagedPaths = new Map<string, string>();

	try {
		for (const relativePath of new Set(relativePaths)) {
			assertNotGlob(relativePath);
			const safePath = sanitizeRelativePath(relativePath);
			const stagedPath = join(directory, crypto.randomUUID(), basename(safePath));
			await mkdir(dirname(stagedPath), { recursive: true });
			await writeFile(stagedPath, await readProjectDatasetBytes(projectId, relativePath));
			stagedPaths.set(relativePath, stagedPath);
		}
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}

	return {
		realPathOf: (relativePath) => {
			const stagedPath = stagedPaths.get(relativePath);
			if (!stagedPath) {
				throw new Error(`File was not staged from project datasets: ${relativePath}`);
			}
			return stagedPath;
		},
		directory,
		release: () => rm(directory, { recursive: true, force: true }),
	};
};

const assertFilesExist = async (projectId: string, relativePaths: string[]): Promise<void> => {
	for (const relativePath of new Set(relativePaths)) {
		if (hasGlob(relativePath)) {
			continue;
		}
		if (!(await statProjectDataset(projectId, relativePath))) {
			throw new Error(`No such project dataset file: ${relativePath}`);
		}
	}
};

const assertNotGlob = (relativePath: string): void => {
	if (hasGlob(relativePath)) {
		throw new Error(
			'Wildcards in project datasets only work on the local storage backend. Name each file instead.',
		);
	}
};

const hasGlob = (relativePath: string): boolean => /[*?[\]]/.test(relativePath);

const isMissing = (error: unknown): boolean => {
	const candidate = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
	return (
		candidate?.code === 'ENOENT' ||
		candidate?.name === 'NoSuchKey' ||
		candidate?.name === 'NotFound' ||
		candidate?.$metadata?.httpStatusCode === 404
	);
};

const sortByName = <T extends { name: string }>(entries: T[]): T[] => {
	return [...entries].sort((a, b) => a.name.localeCompare(b.name));
};
