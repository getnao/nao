import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { __resetStorageForTesting } from '../../src/services/storage';
import { restoreProcessEnvAfterEach } from './process-env-snapshot';

export const userScope = { projectId: 'proj-1', userId: 'user-1' };
export const otherUserScope = { projectId: 'proj-1', userId: 'user-2' };

/** Gives every test a fresh local storage root and restores `process.env` afterwards. Returns the current root. */
export function useTemporaryLocalStorage(): () => string {
	let root = '';

	restoreStorageEnvAfterEach();

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-storage-test-'));
		useStorageBackend('local', root);
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	return () => root;
}

/** Restores `process.env`, the parsed env and the storage singleton after each test. */
export function restoreStorageEnvAfterEach(): void {
	restoreProcessEnvAfterEach({ afterRestore: reloadStorageEnv });
}

export function useStorageBackend(backend: 'none' | 'local' | 's3', localPath?: string): void {
	process.env.NAO_STORAGE_BACKEND = backend;
	if (localPath) {
		process.env.NAO_STORAGE_LOCAL_PATH = localPath;
	}
	process.env.NAO_STORAGE_S3_BUCKET = 'test-bucket';
	reloadStorageEnv();
}

/** Custom stories stay disabled so the file tools never reach the `/stories` mount and its database. */
export function useStorageBackendWithoutStories(backend: 'none' | 'local' | 's3', localPath?: string): void {
	process.env.BETA_CUSTOM_STORIES_ENABLED = 'false';
	useStorageBackend(backend, localPath);
}

function reloadStorageEnv(): void {
	__reloadEnvForTesting();
	__resetStorageForTesting();
}
