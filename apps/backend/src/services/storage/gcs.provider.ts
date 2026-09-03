import { Storage } from '@google-cloud/storage';

import type { StorageHealth, StorageObject, StorageProvider, WriteOptions } from './types';

export interface GcsStorageConfig {
	bucket: string;
	projectId?: string;
	prefix?: string;
	keyFilename?: string;
	credentials?: string;
}

/**
 * Stores files in a Google Cloud Storage bucket. Needs no privileged
 * container because it talks to the GCS API rather than mounting the bucket.
 */
export class GcsStorageProvider implements StorageProvider {
	readonly backend = 'gcs' as const;

	private readonly client: Storage;
	private readonly bucket: string;
	private readonly prefix?: string;

	constructor(config: GcsStorageConfig) {
		this.bucket = config.bucket;
		this.prefix = config.prefix?.replace(/^\/+|\/+$/g, '') || undefined;
		this.client = new Storage({
			projectId: config.projectId,
			keyFilename: config.keyFilename,
			credentials: config.credentials ? JSON.parse(config.credentials) : undefined,
		});
	}

	async write(key: string, data: Buffer, options?: WriteOptions): Promise<StorageObject> {
		const file = this.client.bucket(this.bucket).file(this.toObjectKey(key));
		await file.save(data, { contentType: options?.contentType, resumable: false });

		return { key, size: data.byteLength, contentType: options?.contentType, lastModified: new Date() };
	}

	async read(key: string): Promise<Buffer> {
		const [data] = await this.client.bucket(this.bucket).file(this.toObjectKey(key)).download();
		return data;
	}

	async list(prefix: string): Promise<StorageObject[]> {
		const normalizedPrefix = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
		const listPrefix = this.toObjectKey(normalizedPrefix);

		const [files] = await this.client.bucket(this.bucket).getFiles({ prefix: listPrefix });

		const objects = files.map((file) => ({
			key: this.toStorageKey(file.name),
			size: Number(file.metadata.size ?? 0),
			contentType: file.metadata.contentType,
			lastModified: file.metadata.updated ? new Date(file.metadata.updated) : new Date(0),
		}));

		return objects.sort((a, b) => a.key.localeCompare(b.key));
	}

	async stat(key: string): Promise<StorageObject | null> {
		try {
			const [metadata] = await this.client.bucket(this.bucket).file(this.toObjectKey(key)).getMetadata();

			return {
				key,
				size: Number(metadata.size ?? 0),
				contentType: metadata.contentType,
				lastModified: metadata.updated ? new Date(metadata.updated) : new Date(0),
			};
		} catch (error) {
			if (isNotFound(error)) {
				return null;
			}
			throw error;
		}
	}

	async exists(key: string): Promise<boolean> {
		return (await this.stat(key)) !== null;
	}

	async delete(key: string): Promise<void> {
		try {
			await this.client.bucket(this.bucket).file(this.toObjectKey(key)).delete();
		} catch (error) {
			if (!isNotFound(error)) {
				throw error;
			}
		}
	}

	async healthCheck(): Promise<StorageHealth> {
		try {
			const [exists] = await this.client.bucket(this.bucket).exists();
			if (!exists) {
				return { ok: false, error: `Bucket '${this.bucket}' does not exist or is not reachable` };
			}
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private toObjectKey(key: string): string {
		return this.prefix ? `${this.prefix}/${key}` : key;
	}

	private toStorageKey(objectKey: string): string {
		return this.prefix ? objectKey.slice(this.prefix.length + 1) : objectKey;
	}
}

const isNotFound = (error: unknown): boolean => {
	const candidate = error as { code?: number };
	return candidate?.code === 404;
};
