import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting, STORAGE_DISABLED_MESSAGE } from '../src/services/storage';
import {
	findUserFiles,
	grepRootForUser,
	listUserDirectory,
	readUserFile,
	writeUserFile,
} from '../src/services/storage/user-files';

const scope = { projectId: 'proj-1', userId: 'user-1' };
const otherUser = { projectId: 'proj-1', userId: 'user-2' };

let root: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-user-files-test-'));
	useBackend('local', root);
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(root, { recursive: true, force: true });
});

describe('writeUserFile', () => {
	it('writes inside the user space and reads back', async () => {
		const object = await writeUserFile(scope, 'reports/q1.csv', 'week,customers\n');

		expect(object.key).toBe('projects/proj-1/users/user-1/reports/q1.csv');
		expect(await readUserFile(scope, 'reports/q1.csv')).toBe('week,customers\n');
	});

	it('sets a content type from the extension', async () => {
		expect((await writeUserFile(scope, 'a.csv', 'x')).contentType).toBe('text/csv');
		expect((await writeUserFile(scope, 'a.unknown', 'x')).contentType).toBe('text/plain');
	});

	it('rejects a path that tries to escape the user space', async () => {
		await expect(writeUserFile(scope, '../user-2/stolen.csv', 'x')).rejects.toThrow("may not contain '..'");
	});

	it('fails with an explicit message when storage is disabled', async () => {
		useBackend('none');
		await expect(writeUserFile(scope, 'a.csv', 'x')).rejects.toThrow(STORAGE_DISABLED_MESSAGE);
	});

	it('rejects a file above the size limit and stores nothing', async () => {
		useSizeLimit(1);

		await expect(writeUserFile(scope, 'big.csv', 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(
			'File too large: big.csv is 1.0 MB, above the 1 MB limit',
		);
		await expect(readUserFile(scope, 'big.csv')).rejects.toThrow('No such file in permanent storage');
	});

	it('accepts a file exactly at the size limit', async () => {
		useSizeLimit(1);

		const object = await writeUserFile(scope, 'big.csv', 'x'.repeat(1024 * 1024));
		expect(object.size).toBe(1024 * 1024);
	});

	it('measures the limit in bytes, not characters', async () => {
		useSizeLimit(1);

		await expect(writeUserFile(scope, 'accents.csv', 'é'.repeat(1024 * 512 + 1))).rejects.toThrow('File too large');
	});
});

describe('readUserFile', () => {
	it('reports a missing file with the path the caller asked for', async () => {
		await expect(readUserFile(scope, 'reports/missing.csv')).rejects.toThrow(
			'No such file in permanent storage: reports/missing.csv',
		);
	});
});

describe('listUserDirectory', () => {
	beforeEach(async () => {
		await writeUserFile(scope, 'notes.md', 'notes');
		await writeUserFile(scope, 'reports/q1.csv', 'q1');
		await writeUserFile(scope, 'reports/2025/q2.csv', 'q2');
		await writeUserFile(otherUser, 'theirs.md', 'theirs');
	});

	it('lists directories before files at the root', async () => {
		expect(await listUserDirectory(scope, '')).toEqual([
			{ name: 'reports', relativePath: 'reports', type: 'directory', itemCount: 2 },
			{ name: 'notes.md', relativePath: 'notes.md', type: 'file', size: 5 },
		]);
	});

	it('lists one level of a subdirectory', async () => {
		expect(await listUserDirectory(scope, 'reports')).toEqual([
			{ name: '2025', relativePath: 'reports/2025', type: 'directory', itemCount: 1 },
			{ name: 'q1.csv', relativePath: 'reports/q1.csv', type: 'file', size: 2 },
		]);
	});

	it('never shows another user in the same project', async () => {
		const names = (await listUserDirectory(scope, '')).map((entry) => entry.name);
		expect(names).not.toContain('theirs.md');
	});

	it('returns nothing for a space that has never been written to', async () => {
		expect(await listUserDirectory({ projectId: 'proj-9', userId: 'user-9' }, '')).toEqual([]);
	});
});

describe('findUserFiles', () => {
	beforeEach(async () => {
		await writeUserFile(scope, 'notes.md', 'notes');
		await writeUserFile(scope, 'reports/q1.csv', 'q1');
		await writeUserFile(scope, 'reports/2025/q2.csv', 'q2');
		await writeUserFile(otherUser, 'theirs.csv', 'theirs');
	});

	it('returns every file the predicate accepts, sorted by key', async () => {
		const objects = await findUserFiles(scope, (relativePath) => relativePath.endsWith('.csv'));

		expect(objects.map((object) => object.key)).toEqual([
			'projects/proj-1/users/user-1/reports/2025/q2.csv',
			'projects/proj-1/users/user-1/reports/q1.csv',
		]);
	});

	it('offers the predicate a path relative to the user space', async () => {
		const seen: string[] = [];
		await findUserFiles(scope, (relativePath) => {
			seen.push(relativePath);
			return false;
		});

		expect(seen).toEqual(['notes.md', 'reports/2025/q2.csv', 'reports/q1.csv']);
	});

	it('never offers a file from another user to the predicate', async () => {
		const objects = await findUserFiles(scope, () => true);
		expect(objects.map((object) => object.key)).not.toContain('projects/proj-1/users/user-2/theirs.csv');
	});
});

describe('grepRootForUser', () => {
	it('points at the user space on the local backend', () => {
		expect(grepRootForUser(scope)).toBe(path.join(root, 'projects/proj-1/users/user-1'));
		expect(grepRootForUser(scope, 'reports')).toBe(path.join(root, 'projects/proj-1/users/user-1/reports'));
	});

	it('is unavailable on the s3 backend', () => {
		useBackend('s3');
		expect(() => grepRootForUser(scope)).toThrow('requires the `local` storage backend');
	});

	it('is unavailable when storage is disabled', () => {
		useBackend('none');
		expect(() => grepRootForUser(scope)).toThrow(STORAGE_DISABLED_MESSAGE);
	});
});

function useSizeLimit(megabytes: number): void {
	process.env.NAO_STORAGE_MAX_FILE_SIZE_MB = String(megabytes);
	__reloadEnvForTesting();
}

function useBackend(backend: 'none' | 'local' | 's3', localPath?: string): void {
	process.env.NAO_STORAGE_BACKEND = backend;
	if (localPath) {
		process.env.NAO_STORAGE_LOCAL_PATH = localPath;
	}
	process.env.NAO_STORAGE_S3_BUCKET = 'test-bucket';
	__reloadEnvForTesting();
	__resetStorageForTesting();
}
