export type StorageBackend = 'local' | 's3';

/** What the admin configured, including turning permanent storage off entirely. */
export type StorageBackendSetting = StorageBackend | 'none';

/**
 * Identifies the space a set of files belongs to. Every key is built from a
 * scope, so callers can never reach another user's or project's files.
 */
export interface StorageScope {
	projectId: string;
	userId: string;
}

export interface StorageObject {
	key: string;
	size: number;
	contentType?: string;
	lastModified: Date;
}

export interface StorageHealth {
	ok: boolean;
	error?: string;
}

export interface WriteOptions {
	contentType?: string;
}

export interface StorageProvider {
	readonly backend: StorageBackend;
	write(key: string, data: Buffer, options?: WriteOptions): Promise<StorageObject>;
	read(key: string): Promise<Buffer>;
	/** Lists every object below `prefix`, which is matched at path-segment boundaries. */
	list(prefix: string): Promise<StorageObject[]>;
	stat(key: string): Promise<StorageObject | null>;
	exists(key: string): Promise<boolean>;
	delete(key: string): Promise<void>;
	healthCheck(): Promise<StorageHealth>;
}
