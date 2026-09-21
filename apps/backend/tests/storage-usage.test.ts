import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import { getProjectUsageByUser, getScopeUsage } from '../src/services/storage/usage';
import { writeUserFile } from '../src/services/storage/user-files';

const scope = { projectId: 'proj-1', userId: 'user-1' };
const otherUser = { projectId: 'proj-1', userId: 'user-2' };
const otherProject = { projectId: 'proj-2', userId: 'user-1' };

let root: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-usage-test-'));
	useBackend('local', root);
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(root, { recursive: true, force: true });
});

describe('getScopeUsage', () => {
	it('counts every file of the user, at any depth', async () => {
		await writeUserFile(scope, 'notes.md', 'ab');
		await writeUserFile(scope, 'reports/2025/q1.csv', 'abcd');

		expect(await getScopeUsage(scope)).toEqual({ fileCount: 2, totalBytes: 6 });
	});

	it('ignores files of other users and other projects', async () => {
		await writeUserFile(otherUser, 'theirs.csv', 'abcd');
		await writeUserFile(otherProject, 'elsewhere.csv', 'abcd');

		expect(await getScopeUsage(scope)).toEqual({ fileCount: 0, totalBytes: 0 });
	});

	it('reports an empty space when storage is disabled', async () => {
		useBackend('none');
		expect(await getScopeUsage(scope)).toEqual({ fileCount: 0, totalBytes: 0 });
	});
});

describe('getProjectUsageByUser', () => {
	it('groups the project by user, heaviest space first', async () => {
		await writeUserFile(scope, 'notes.md', 'ab');
		await writeUserFile(otherUser, 'reports/q1.csv', 'abcd');
		await writeUserFile(otherUser, 'reports/q2.csv', 'a');

		expect(await getProjectUsageByUser('proj-1')).toEqual([
			{ userId: 'user-2', fileCount: 2, totalBytes: 5 },
			{ userId: 'user-1', fileCount: 1, totalBytes: 2 },
		]);
	});

	it('leaves out other projects', async () => {
		await writeUserFile(otherProject, 'elsewhere.csv', 'abcd');
		expect(await getProjectUsageByUser('proj-1')).toEqual([]);
	});

	it('reports nothing when storage is disabled', async () => {
		useBackend('none');
		expect(await getProjectUsageByUser('proj-1')).toEqual([]);
	});
});

function useBackend(backend: 'none' | 'local' | 's3', localPath?: string): void {
	process.env.NAO_STORAGE_BACKEND = backend;
	if (localPath) {
		process.env.NAO_STORAGE_LOCAL_PATH = localPath;
	}
	process.env.NAO_STORAGE_S3_BUCKET = 'test-bucket';
	__reloadEnvForTesting();
	__resetStorageForTesting();
}
