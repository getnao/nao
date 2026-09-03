import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	bucketConfigs: [] as Record<string, never>[],
	storageConfigs: [] as Record<string, never>[],
	save: vi.fn(async () => {}),
	download: vi.fn(async () => [Buffer.from('')]),
	getMetadata: vi.fn(async () => [{}]),
	deleteFile: vi.fn(async () => {}),
	getFiles: vi.fn(async () => [[]]),
	bucketExists: vi.fn(async () => [true]),
}));

vi.mock('@google-cloud/storage', () => {
	class FakeFile {
		constructor(
			public bucketName: string,
			public name: string,
		) {}
		save(data: Buffer, options: Record<string, never>) {
			return mocks.save(data, options);
		}
		download() {
			return mocks.download();
		}
		getMetadata() {
			return mocks.getMetadata();
		}
		delete() {
			return mocks.deleteFile();
		}
	}

	class FakeBucket {
		constructor(public name: string) {}
		file(name: string) {
			return new FakeFile(this.name, name);
		}
		getFiles(config: Record<string, never>) {
			mocks.bucketConfigs.push(config);
			return mocks.getFiles();
		}
		exists() {
			return mocks.bucketExists();
		}
	}

	class Storage {
		constructor(config: Record<string, never>) {
			mocks.storageConfigs.push(config);
		}
		bucket(name: string) {
			return new FakeBucket(name);
		}
	}

	return { Storage };
});

const { GcsStorageProvider } = await import('../src/services/storage/gcs.provider');

const baseConfig = { bucket: 'my-bucket' };

beforeEach(() => {
	mocks.bucketConfigs.length = 0;
	mocks.storageConfigs.length = 0;
	mocks.save.mockReset().mockImplementation(async () => {});
	mocks.download.mockReset().mockImplementation(async () => [Buffer.from('')]);
	mocks.getMetadata.mockReset().mockImplementation(async () => [{}]);
	mocks.deleteFile.mockReset().mockImplementation(async () => {});
	mocks.getFiles.mockReset().mockImplementation(async () => [[]]);
	mocks.bucketExists.mockReset().mockImplementation(async () => [true]);
});

describe('GcsStorageProvider keys', () => {
	it('sends the key as-is when no prefix is configured', async () => {
		const storage = new GcsStorageProvider(baseConfig);
		await storage.write('projects/p1/users/u1/a.csv', Buffer.from('x'));

		expect(mocks.save).toHaveBeenCalledWith(Buffer.from('x'), expect.objectContaining({ resumable: false }));
	});

	it('prepends the configured prefix', async () => {
		const spy = vi.fn(async () => {});
		mocks.save.mockImplementation(spy);

		const storage = new GcsStorageProvider({ ...baseConfig, prefix: 'nao' });
		await storage.write('a.csv', Buffer.from('x'));

		expect(spy).toHaveBeenCalled();
	});

	it('passes the content type through', async () => {
		const storage = new GcsStorageProvider(baseConfig);
		await storage.write('a.csv', Buffer.from('x'), { contentType: 'text/csv' });

		expect(mocks.save).toHaveBeenCalledWith(Buffer.from('x'), { contentType: 'text/csv', resumable: false });
	});
});

describe('GcsStorageProvider read', () => {
	it('returns the object body as a buffer', async () => {
		mocks.download.mockImplementation(async () => [Buffer.from('week,customers\n')]);

		const storage = new GcsStorageProvider(baseConfig);
		expect((await storage.read('a.csv')).toString()).toBe('week,customers\n');
	});
});

describe('GcsStorageProvider list', () => {
	it('matches the prefix at a segment boundary and strips the configured prefix', async () => {
		mocks.getFiles.mockImplementation(async () => [
			[
				{
					name: 'nao/projects/p1/users/u1/a.csv',
					metadata: { size: '3', updated: new Date(0).toISOString() },
				},
			],
		]);

		const storage = new GcsStorageProvider({ ...baseConfig, prefix: 'nao' });
		const objects = await storage.list('projects/p1/users/u1');

		expect(mocks.bucketConfigs.at(-1)?.prefix).toBe('nao/projects/p1/users/u1/');
		expect(objects).toEqual([
			{
				key: 'projects/p1/users/u1/a.csv',
				size: 3,
				contentType: undefined,
				lastModified: new Date(0),
			},
		]);
	});

	it('does not double the trailing slash', async () => {
		const storage = new GcsStorageProvider(baseConfig);
		await storage.list('projects/p1/');

		expect(mocks.bucketConfigs.at(-1)?.prefix).toBe('projects/p1/');
	});

	it('lists the root without inventing a slash prefix', async () => {
		await new GcsStorageProvider(baseConfig).list('');
		expect(mocks.bucketConfigs.at(-1)?.prefix).toBe('');

		await new GcsStorageProvider({ ...baseConfig, prefix: 'nao' }).list('');
		expect(mocks.bucketConfigs.at(-1)?.prefix).toBe('nao/');
	});
});

describe('GcsStorageProvider stat', () => {
	it('maps metadata onto a storage object', async () => {
		mocks.getMetadata.mockImplementation(async () => [
			{ size: '12', contentType: 'text/csv', updated: new Date(0).toISOString() },
		]);

		const storage = new GcsStorageProvider(baseConfig);
		expect(await storage.stat('a.csv')).toEqual({
			key: 'a.csv',
			size: 12,
			contentType: 'text/csv',
			lastModified: new Date(0),
		});
	});

	it('returns null for a missing object', async () => {
		mocks.getMetadata.mockImplementation(async () => {
			throw Object.assign(new Error('Not Found'), { code: 404 });
		});

		const storage = new GcsStorageProvider(baseConfig);
		expect(await storage.stat('missing.csv')).toBeNull();
		expect(await storage.exists('missing.csv')).toBe(false);
	});

	it('propagates errors that are not a missing object', async () => {
		mocks.getMetadata.mockImplementation(async () => {
			throw Object.assign(new Error('Access Denied'), { code: 403 });
		});

		const storage = new GcsStorageProvider(baseConfig);
		await expect(storage.stat('a.csv')).rejects.toThrow('Access Denied');
	});
});

describe('GcsStorageProvider healthCheck', () => {
	it('checks the bucket exists and reports success', async () => {
		const storage = new GcsStorageProvider(baseConfig);

		expect(await storage.healthCheck()).toEqual({ ok: true });
	});

	it('reports when the bucket does not exist', async () => {
		mocks.bucketExists.mockImplementation(async () => [false]);

		const storage = new GcsStorageProvider(baseConfig);
		expect(await storage.healthCheck()).toEqual({
			ok: false,
			error: "Bucket 'my-bucket' does not exist or is not reachable",
		});
	});

	it('reports the failure reason instead of throwing', async () => {
		mocks.bucketExists.mockImplementation(async () => {
			throw new Error('The specified bucket does not exist');
		});

		const storage = new GcsStorageProvider(baseConfig);
		expect(await storage.healthCheck()).toEqual({
			ok: false,
			error: 'The specified bucket does not exist',
		});
	});
});

describe('GcsStorageProvider credentials', () => {
	it('passes the project id and key file through to the client', () => {
		new GcsStorageProvider({ ...baseConfig, projectId: 'my-project', keyFilename: '/etc/nao/key.json' });

		expect(mocks.storageConfigs[0]).toEqual(
			expect.objectContaining({ projectId: 'my-project', keyFilename: '/etc/nao/key.json' }),
		);
	});

	it('parses inline credentials JSON', () => {
		new GcsStorageProvider({ ...baseConfig, credentials: '{"client_email":"a@b.iam.gserviceaccount.com"}' });

		expect(mocks.storageConfigs[0].credentials).toEqual({ client_email: 'a@b.iam.gserviceaccount.com' });
	});

	it('falls back to application default credentials when none are set', () => {
		new GcsStorageProvider(baseConfig);

		expect(mocks.storageConfigs[0].keyFilename).toBeUndefined();
		expect(mocks.storageConfigs[0].credentials).toBeUndefined();
	});
});
