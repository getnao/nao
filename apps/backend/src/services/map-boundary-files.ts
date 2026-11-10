import { randomUUID } from 'node:crypto';

import { MAX_BOUNDARY_FILE_BYTES, type UploadedBoundaryFile, validateGeoJson } from '@nao/shared';

import { logger } from '../utils/logger';
import { getStorage, isStorageEnabled, STORAGE_DISABLED_MESSAGE } from './storage';
import { projectRoot } from './storage/keys';

export interface StoredBoundaryFile {
	file: UploadedBoundaryFile;
	featureCount: number;
}

/**
 * Validates an uploaded GeoJSON and writes it to the project's permanent storage, outside every user's space.
 * @throws Error when storage is disabled, the GeoJSON is invalid or the file is too large.
 */
export const saveBoundaryFile = async (
	projectId: string,
	upload: { fileName: string; geojson: unknown },
): Promise<StoredBoundaryFile> => {
	if (!isStorageEnabled()) {
		throw new Error(STORAGE_DISABLED_MESSAGE);
	}
	const { geojson, featureCount } = validateGeoJson(upload.geojson);
	const data = Buffer.from(JSON.stringify(geojson));
	if (data.byteLength > MAX_BOUNDARY_FILE_BYTES) {
		throw new Error(`GeoJSON files may not exceed ${MAX_BOUNDARY_FILE_BYTES / 1024 / 1024} MB.`);
	}
	const storageKey = `${projectRoot(projectId)}/map-boundaries/${randomUUID()}.geojson`;
	const stored = await getStorage().write(storageKey, data, { contentType: 'application/geo+json' });
	return { file: { name: upload.fileName, size: stored.size, storageKey }, featureCount };
};

export const readBoundaryFile = async (storageKey: string): Promise<string> => {
	return (await getStorage().read(storageKey)).toString('utf8');
};

/** A file left behind only wastes space, so a failed delete is logged rather than failing the settings change. */
export const deleteBoundaryFile = async (file: UploadedBoundaryFile | undefined): Promise<void> => {
	if (!file || !isStorageEnabled()) {
		return;
	}
	try {
		await getStorage().delete(file.storageKey);
	} catch (error) {
		logger.warn(`Failed to delete GeoJSON file ${file.storageKey}: ${String(error)}`, { source: 'system' });
	}
};
