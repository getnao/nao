import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scopedKey, scopeRoot } from '../src/services/storage/keys';
import { LocalStorageProvider } from '../src/services/storage/local.provider';

const scope = { projectId: 'proj-1', userId: 'user-1' };
const otherUser = { projectId: 'proj-1', userId: 'user-2' };

let root: string;
let storage: LocalStorageProvider;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-storage-test-'));
	storage = new LocalStorageProvider(root);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('LocalStorageProvider', () => {
	it('writes and reads a file back', async () => {
		const key = scopedKey(scope, 'reports/q1.csv');
		const written = await storage.write(key, Buffer.from('week,customers\n'));

		expect(written.key).toBe(key);
		expect(written.size).toBe(15);
		expect((await storage.read(key)).toString()).toBe('week,customers\n');
	});

	it('creates missing parent directories', async () => {
		const key = scopedKey(scope, 'deeply/nested/tree/file.txt');
		await storage.write(key, Buffer.from('hello'));

		expect(await storage.exists(key)).toBe(true);
	});

	it('overwrites an existing file', async () => {
		const key = scopedKey(scope, 'notes.txt');
		await storage.write(key, Buffer.from('first'));
		await storage.write(key, Buffer.from('second'));

		expect((await storage.read(key)).toString()).toBe('second');
	});

	it('reports a missing file rather than throwing', async () => {
		const key = scopedKey(scope, 'missing.txt');

		expect(await storage.stat(key)).toBeNull();
		expect(await storage.exists(key)).toBe(false);
	});

	it('deletes a file and tolerates deleting it twice', async () => {
		const key = scopedKey(scope, 'temp.txt');
		await storage.write(key, Buffer.from('x'));

		await storage.delete(key);
		await storage.delete(key);

		expect(await storage.exists(key)).toBe(false);
	});

	it('lists every file under a scope, sorted and recursive', async () => {
		await storage.write(scopedKey(scope, 'b/second.txt'), Buffer.from('2'));
		await storage.write(scopedKey(scope, 'a/first.txt'), Buffer.from('1'));
		await storage.write(scopedKey(scope, 'root.txt'), Buffer.from('0'));

		const keys = (await storage.list(scopeRoot(scope))).map((object) => object.key);

		expect(keys).toEqual([
			'projects/proj-1/users/user-1/a/first.txt',
			'projects/proj-1/users/user-1/b/second.txt',
			'projects/proj-1/users/user-1/root.txt',
		]);
	});

	it('does not list another user in the same project', async () => {
		await storage.write(scopedKey(scope, 'mine.txt'), Buffer.from('mine'));
		await storage.write(scopedKey(otherUser, 'theirs.txt'), Buffer.from('theirs'));

		const keys = (await storage.list(scopeRoot(scope))).map((object) => object.key);

		expect(keys).toEqual(['projects/proj-1/users/user-1/mine.txt']);
	});

	it('returns an empty list for a scope that has never been written to', async () => {
		expect(await storage.list(scopeRoot(scope))).toEqual([]);
	});

	it('matches list prefixes at segment boundaries', async () => {
		await storage.write('projects/proj-1/users/user-1/file.txt', Buffer.from('a'));
		await storage.write('projects/proj-10/users/user-1/file.txt', Buffer.from('b'));

		const keys = (await storage.list('projects/proj-1')).map((object) => object.key);

		expect(keys).toEqual(['projects/proj-1/users/user-1/file.txt']);
	});

	it('refuses a key that escapes the storage root', async () => {
		await expect(storage.read('../outside.txt')).rejects.toThrow('resolves outside the storage root');
		await expect(storage.write('../outside.txt', Buffer.from('x'))).rejects.toThrow(
			'resolves outside the storage root',
		);
	});

	it('reports a healthy root and leaves no probe file behind', async () => {
		expect(await storage.healthCheck()).toEqual({ ok: true });
		expect(await fs.readdir(root)).toEqual([]);
	});

	it('creates the root on the health check when it does not exist yet', async () => {
		const missingRoot = path.join(root, 'not-created-yet');
		const health = await new LocalStorageProvider(missingRoot).healthCheck();

		expect(health.ok).toBe(true);
		await expect(fs.stat(missingRoot)).resolves.toBeDefined();
	});

	it('reports an unhealthy root when it cannot be written to', async () => {
		const filePath = path.join(root, 'a-file');
		await fs.writeFile(filePath, '');

		const health = await new LocalStorageProvider(path.join(filePath, 'nested')).healthCheck();

		expect(health.ok).toBe(false);
		expect(health.error).toBeTruthy();
	});
});
