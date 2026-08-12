import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import type { StorageHealth, StorageObject, StorageProvider, WriteOptions } from './types';

const MAX_OBJECT_KEY_BYTES = 1024;

export interface S3StorageConfig {
	bucket: string;
	region?: string;
	endpoint?: string;
	prefix?: string;
	forcePathStyle: boolean;
	accessKeyId?: string;
	secretAccessKey?: string;
}

/**
 * Stores files in an S3 or S3-compatible bucket. Works with AWS S3, MinIO,
 * Cloudflare R2 and Backblaze B2, and needs no privileged container because it
 * talks to the API rather than mounting the bucket.
 */
export class S3StorageProvider implements StorageProvider {
	readonly backend = 's3' as const;

	private readonly client: S3Client;
	private readonly bucket: string;
	private readonly prefix?: string;

	constructor(config: S3StorageConfig) {
		this.bucket = config.bucket;
		this.prefix = config.prefix?.replace(/^\/+|\/+$/g, '') || undefined;
		this.client = new S3Client({
			region: config.region,
			endpoint: config.endpoint,
			forcePathStyle: config.forcePathStyle,
			credentials: buildCredentials(config),
		});
	}

	async write(key: string, data: Buffer, options?: WriteOptions): Promise<StorageObject> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: this.toObjectKey(key),
				Body: data,
				ContentType: options?.contentType,
			}),
		);

		return { key, size: data.byteLength, contentType: options?.contentType, lastModified: new Date() };
	}

	async read(key: string): Promise<Buffer> {
		const response = await this.client.send(
			new GetObjectCommand({ Bucket: this.bucket, Key: this.toObjectKey(key) }),
		);

		if (!response.Body) {
			throw new Error(`Object '${key}' has no content`);
		}

		return Buffer.from(await response.Body.transformToByteArray());
	}

	async list(prefix: string): Promise<StorageObject[]> {
		const objects: StorageObject[] = [];
		const normalizedPrefix = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
		const listPrefix = this.toObjectKey(normalizedPrefix);
		let continuationToken: string | undefined;

		do {
			const response = await this.client.send(
				new ListObjectsV2Command({
					Bucket: this.bucket,
					Prefix: listPrefix,
					ContinuationToken: continuationToken,
				}),
			);

			for (const object of response.Contents ?? []) {
				if (!object.Key) {
					continue;
				}
				objects.push({
					key: this.toStorageKey(object.Key),
					size: object.Size ?? 0,
					lastModified: object.LastModified ?? new Date(0),
				});
			}

			continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
		} while (continuationToken);

		return objects.sort((a, b) => a.key.localeCompare(b.key));
	}

	async stat(key: string): Promise<StorageObject | null> {
		try {
			const response = await this.client.send(
				new HeadObjectCommand({ Bucket: this.bucket, Key: this.toObjectKey(key) }),
			);

			return {
				key,
				size: response.ContentLength ?? 0,
				contentType: response.ContentType,
				lastModified: response.LastModified ?? new Date(0),
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
		await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.toObjectKey(key) }));
	}

	async healthCheck(): Promise<StorageHealth> {
		try {
			await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private toObjectKey(key: string): string {
		const objectKey = this.prefix ? `${this.prefix}/${key}` : key;
		if (Buffer.byteLength(objectKey) > MAX_OBJECT_KEY_BYTES) {
			throw new Error(
				`S3 object key is too long: keys including the configured prefix may not exceed 1024 bytes`,
			);
		}
		return objectKey;
	}

	private toStorageKey(objectKey: string): string {
		return this.prefix ? objectKey.slice(this.prefix.length + 1) : objectKey;
	}
}

/**
 * Falls back to the default AWS credential chain so IAM roles, ECS task roles
 * and EKS/IRSA work without any nao-specific configuration.
 */
const buildCredentials = (config: S3StorageConfig) => {
	if (config.accessKeyId && config.secretAccessKey) {
		return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
	}
	return fromNodeProviderChain();
};

const isNotFound = (error: unknown): boolean => {
	const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
	return candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404;
};
