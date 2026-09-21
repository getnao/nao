import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	sent: [] as { type: string; input: Record<string, never> }[],
	clientConfigs: [] as Record<string, never>[],
	respond: (() => ({})) as (type: string, input: Record<string, never>) => unknown,
}));

vi.mock('@aws-sdk/credential-providers', () => ({
	fromNodeProviderChain: () => 'default-chain',
}));

vi.mock('@aws-sdk/client-s3', () => {
	class FakeCommand {
		static type = 'Unknown';
		constructor(public input: Record<string, never>) {}
		get type(): string {
			return (this.constructor as typeof FakeCommand).type;
		}
	}

	class S3Client {
		constructor(config: Record<string, never>) {
			mocks.clientConfigs.push(config);
		}
		async send(command: FakeCommand) {
			mocks.sent.push({ type: command.type, input: command.input });
			return mocks.respond(command.type, command.input);
		}
	}

	return {
		S3Client,
		PutObjectCommand: class extends FakeCommand {
			static type = 'PutObject';
		},
		GetObjectCommand: class extends FakeCommand {
			static type = 'GetObject';
		},
		HeadObjectCommand: class extends FakeCommand {
			static type = 'HeadObject';
		},
		HeadBucketCommand: class extends FakeCommand {
			static type = 'HeadBucket';
		},
		ListObjectsV2Command: class extends FakeCommand {
			static type = 'ListObjectsV2';
		},
		DeleteObjectCommand: class extends FakeCommand {
			static type = 'DeleteObject';
		},
	};
});

const { S3StorageProvider } = await import('../src/services/storage/s3.provider');

const baseConfig = { bucket: 'my-bucket', region: 'eu-west-1', forcePathStyle: false };

beforeEach(() => {
	mocks.sent.length = 0;
	mocks.clientConfigs.length = 0;
	mocks.respond = () => ({});
});

const lastInput = () => mocks.sent.at(-1)!.input as Record<string, unknown>;

describe('S3StorageProvider keys', () => {
	it('sends the key as-is when no prefix is configured', async () => {
		const storage = new S3StorageProvider(baseConfig);
		await storage.write('projects/p1/users/u1/a.csv', Buffer.from('x'));

		expect(lastInput().Key).toBe('projects/p1/users/u1/a.csv');
		expect(lastInput().Bucket).toBe('my-bucket');
	});

	it('prepends the configured prefix', async () => {
		const storage = new S3StorageProvider({ ...baseConfig, prefix: 'nao' });
		await storage.write('projects/p1/users/u1/a.csv', Buffer.from('x'));

		expect(lastInput().Key).toBe('nao/projects/p1/users/u1/a.csv');
	});

	it('tolerates a prefix written with surrounding slashes', async () => {
		const storage = new S3StorageProvider({ ...baseConfig, prefix: '/nao/' });
		await storage.write('a.csv', Buffer.from('x'));

		expect(lastInput().Key).toBe('nao/a.csv');
	});

	it('passes the content type through', async () => {
		const storage = new S3StorageProvider(baseConfig);
		await storage.write('a.csv', Buffer.from('x'), { contentType: 'text/csv' });

		expect(lastInput().ContentType).toBe('text/csv');
	});

	it('rejects a key that exceeds the S3 limit after adding the configured prefix', async () => {
		const storage = new S3StorageProvider({ ...baseConfig, prefix: 'nao' });

		await expect(storage.write('a'.repeat(1021), Buffer.from('x'))).rejects.toThrow(
			'including the configured prefix',
		);
	});
});

describe('S3StorageProvider read', () => {
	it('returns the object body as a buffer', async () => {
		mocks.respond = () => ({
			Body: { transformToByteArray: async () => new TextEncoder().encode('week,customers\n') },
		});

		const storage = new S3StorageProvider(baseConfig);
		expect((await storage.read('a.csv')).toString()).toBe('week,customers\n');
	});

	it('fails when the object has no body', async () => {
		mocks.respond = () => ({});

		const storage = new S3StorageProvider(baseConfig);
		await expect(storage.read('a.csv')).rejects.toThrow('has no content');
	});
});

describe('S3StorageProvider list', () => {
	it('matches the prefix at a segment boundary and strips the configured prefix', async () => {
		mocks.respond = () => ({
			Contents: [{ Key: 'nao/projects/p1/users/u1/a.csv', Size: 3, LastModified: new Date(0) }],
		});

		const storage = new S3StorageProvider({ ...baseConfig, prefix: 'nao' });
		const objects = await storage.list('projects/p1/users/u1');

		expect(lastInput().Prefix).toBe('nao/projects/p1/users/u1/');
		expect(objects).toEqual([{ key: 'projects/p1/users/u1/a.csv', size: 3, lastModified: new Date(0) }]);
	});

	it('does not double the trailing slash', async () => {
		mocks.respond = () => ({ Contents: [] });

		const storage = new S3StorageProvider(baseConfig);
		await storage.list('projects/p1/');

		expect(lastInput().Prefix).toBe('projects/p1/');
	});

	it('lists the root without inventing a slash prefix', async () => {
		mocks.respond = () => ({ Contents: [] });

		await new S3StorageProvider(baseConfig).list('');
		expect(lastInput().Prefix).toBe('');

		await new S3StorageProvider({ ...baseConfig, prefix: 'nao' }).list('');
		expect(lastInput().Prefix).toBe('nao/');
	});

	it('follows pagination until the listing is complete', async () => {
		let page = 0;
		mocks.respond = () => {
			page += 1;
			if (page === 1) {
				return {
					Contents: [{ Key: 'b.csv', Size: 1, LastModified: new Date(0) }],
					IsTruncated: true,
					NextContinuationToken: 'token-2',
				};
			}
			return { Contents: [{ Key: 'a.csv', Size: 1, LastModified: new Date(0) }], IsTruncated: false };
		};

		const storage = new S3StorageProvider(baseConfig);
		const objects = await storage.list('');

		expect(mocks.sent).toHaveLength(2);
		expect(mocks.sent[1].input.ContinuationToken).toBe('token-2');
		expect(objects.map((object) => object.key)).toEqual(['a.csv', 'b.csv']);
	});
});

describe('S3StorageProvider stat', () => {
	it('maps head metadata onto a storage object', async () => {
		mocks.respond = () => ({ ContentLength: 12, ContentType: 'text/csv', LastModified: new Date(0) });

		const storage = new S3StorageProvider(baseConfig);
		expect(await storage.stat('a.csv')).toEqual({
			key: 'a.csv',
			size: 12,
			contentType: 'text/csv',
			lastModified: new Date(0),
		});
	});

	it('returns null for a missing object', async () => {
		mocks.respond = () => {
			throw Object.assign(new Error('Not Found'), { name: 'NotFound' });
		};

		const storage = new S3StorageProvider(baseConfig);
		expect(await storage.stat('missing.csv')).toBeNull();
		expect(await storage.exists('missing.csv')).toBe(false);
	});

	it('propagates errors that are not a missing object', async () => {
		mocks.respond = () => {
			throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
		};

		const storage = new S3StorageProvider(baseConfig);
		await expect(storage.stat('a.csv')).rejects.toThrow('Access Denied');
	});
});

describe('S3StorageProvider healthCheck', () => {
	it('heads the bucket and reports success', async () => {
		const storage = new S3StorageProvider(baseConfig);

		expect(await storage.healthCheck()).toEqual({ ok: true });
		expect(mocks.sent.at(-1)!.type).toBe('HeadBucket');
	});

	it('reports the failure reason instead of throwing', async () => {
		mocks.respond = () => {
			throw new Error('The specified bucket does not exist');
		};

		const storage = new S3StorageProvider(baseConfig);
		expect(await storage.healthCheck()).toEqual({
			ok: false,
			error: 'The specified bucket does not exist',
		});
	});
});

describe('S3StorageProvider credentials', () => {
	it('uses explicit credentials when both are set', () => {
		new S3StorageProvider({ ...baseConfig, accessKeyId: 'AKIA', secretAccessKey: 'secret' });

		expect(mocks.clientConfigs[0].credentials).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'secret' });
	});

	it('falls back to the default credential chain when only one is set', () => {
		new S3StorageProvider({ ...baseConfig, accessKeyId: 'AKIA' });

		expect(mocks.clientConfigs[0].credentials).toBe('default-chain');
	});

	it('falls back to the default credential chain when neither is set', () => {
		new S3StorageProvider(baseConfig);

		expect(mocks.clientConfigs[0].credentials).toBe('default-chain');
	});

	it('forwards the endpoint and path style used by S3-compatible providers', () => {
		new S3StorageProvider({ ...baseConfig, endpoint: 'https://minio.internal:9000', forcePathStyle: true });

		expect(mocks.clientConfigs[0].endpoint).toBe('https://minio.internal:9000');
		expect(mocks.clientConfigs[0].forcePathStyle).toBe(true);
	});
});
