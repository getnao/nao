import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { getStorage, isStorageEnabled } from '.';
import { sanitizeRelativePath, scopedKey, scopeRoot } from './keys';
import { LocalStorageProvider } from './local.provider';
import type { StorageScope } from './types';
import { readUserFileBytes, statUserFile } from './user-files';

export interface StorageFileAccess {
	/** Real path of a file inside the user's space, for a process that opens files itself. */
	realPathOf: (relativePath: string) => string;
	/** The one directory that has to be reachable to open those paths. */
	directory: string;
	/** Drops anything staged on the way. Always call it. */
	release: () => Promise<void>;
}

/**
 * Makes a user's stored files openable on the local filesystem, so a tool that speaks paths
 * rather than object keys can read them.
 *
 * On the `local` backend the files are already there and the whole user space is handed over, which
 * keeps globs working. On `s3` there is no filesystem, so only the named files are staged into a
 * temporary directory that lives no longer than the caller.
 *
 * @param relativePaths Paths the caller intends to open, relative to the user's space.
 */
export const openStorageFiles = async (scope: StorageScope, relativePaths: string[]): Promise<StorageFileAccess> => {
	if (!isStorageEnabled()) {
		throw new Error(
			'Permanent storage is disabled, so there are no files under /home to read. Ask an admin to enable it.',
		);
	}

	const storage = getStorage();

	if (storage instanceof LocalStorageProvider) {
		await assertFilesExist(scope, relativePaths);

		return {
			realPathOf: (relativePath) => storage.toFilePath(scopedKey(scope, relativePath)),
			directory: storage.toFilePath(scopeRoot(scope)),
			release: async () => {},
		};
	}

	return stageFiles(scope, relativePaths);
};

/** Copies the named files out of object storage into a directory only this caller can see. */
const stageFiles = async (scope: StorageScope, relativePaths: string[]): Promise<StorageFileAccess> => {
	const directory = await mkdtemp(join(tmpdir(), 'nao-storage-'));
	const stagedPaths = new Map<string, string>();

	try {
		for (const relativePath of new Set(relativePaths)) {
			assertNotGlob(relativePath);
			const safePath = sanitizeRelativePath(relativePath);
			const stagedPath = join(directory, randomUUID(), basename(safePath));
			await mkdir(dirname(stagedPath), { recursive: true });
			await writeFile(stagedPath, await readUserFileBytes(scope, relativePath));
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
				throw new Error(`File was not staged from permanent storage: ${relativePath}`);
			}
			return stagedPath;
		},
		directory,
		release: () => rm(directory, { recursive: true, force: true }),
	};
};

/** Reports a missing file by name, rather than leaving the caller to explain an open failure. */
const assertFilesExist = async (scope: StorageScope, relativePaths: string[]): Promise<void> => {
	for (const relativePath of new Set(relativePaths)) {
		if (hasGlob(relativePath)) {
			continue;
		}
		if (!(await statUserFile(scope, relativePath))) {
			throw new Error(`No such file in permanent storage: ${relativePath}`);
		}
	}
};

const assertNotGlob = (relativePath: string): void => {
	if (hasGlob(relativePath)) {
		throw new Error(
			`Wildcards like '${relativePath}' only work on the local storage backend. Name each file, or use search to list them first.`,
		);
	}
};

const hasGlob = (relativePath: string): boolean => {
	return /[*?[\]]/.test(relativePath);
};
