import fs from 'node:fs/promises';
import path from 'node:path';

import type { StorageHealth, StorageObject, StorageProvider, WriteOptions } from './types';

const HEALTH_PROBE_KEY = '.nao-storage-health';

/**
 * Stores files on a local directory. When nao runs with more than one replica
 * the root must be a shared read-write-many volume, otherwise each replica
 * sees a different set of files.
 *
 * Content types are not persisted: the filesystem has nowhere to put them.
 */
export class LocalStorageProvider implements StorageProvider {
	readonly backend = 'local' as const;
	readonly root: string;

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	async write(key: string, data: Buffer, options?: WriteOptions): Promise<StorageObject> {
		const filePath = this.toFilePath(key);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, data);

		const stats = await fs.stat(filePath);
		return { key, size: stats.size, contentType: options?.contentType, lastModified: stats.mtime };
	}

	async read(key: string): Promise<Buffer> {
		return fs.readFile(this.toFilePath(key));
	}

	async list(prefix: string): Promise<StorageObject[]> {
		const objects: StorageObject[] = [];

		for await (const filePath of this.walk(this.toFilePath(prefix))) {
			const stats = await fs.stat(filePath);
			objects.push({
				key: this.toKey(filePath),
				size: stats.size,
				lastModified: stats.mtime,
			});
		}

		return objects.sort((a, b) => a.key.localeCompare(b.key));
	}

	async stat(key: string): Promise<StorageObject | null> {
		try {
			const stats = await fs.stat(this.toFilePath(key));
			if (!stats.isFile()) {
				return null;
			}
			return { key, size: stats.size, lastModified: stats.mtime };
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
		await fs.rm(this.toFilePath(key), { force: true });
	}

	async healthCheck(): Promise<StorageHealth> {
		const probePath = path.join(this.root, HEALTH_PROBE_KEY);

		try {
			await fs.mkdir(this.root, { recursive: true });
			await fs.writeFile(probePath, '');
			await fs.rm(probePath, { force: true });
			return { ok: true };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private async *walk(directory: string): AsyncGenerator<string> {
		let entries;
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (isNotFound(error)) {
				return;
			}
			throw error;
		}

		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				yield* this.walk(entryPath);
			} else if (entry.isFile()) {
				yield entryPath;
			}
		}
	}

	/**
	 * Absolute path of a key. Keys are already sanitised, so the containment
	 * re-check exists to guarantee that no path can ever resolve outside the
	 * root even if a caller bypasses `keys.ts`.
	 */
	toFilePath(key: string): string {
		const filePath = path.resolve(this.root, key);
		const isInsideRoot = filePath === this.root || filePath.startsWith(this.root + path.sep);

		if (!isInsideRoot) {
			throw new Error(`Access denied: '${key}' resolves outside the storage root`);
		}

		return filePath;
	}

	private toKey(filePath: string): string {
		return path.relative(this.root, filePath).replaceAll(path.sep, '/');
	}
}

const isNotFound = (error: unknown): boolean => {
	return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
};
