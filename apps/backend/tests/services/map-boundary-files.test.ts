import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBoundarySet } from '@nao/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import { deleteBoundaryFile, saveBoundaryFile } from '../../src/services/map-boundary-files';
import { __resetStorageForTesting, STORAGE_DISABLED_MESSAGE } from '../../src/services/storage';
import { loadBoundarySet } from '../../src/utils/map-boundary-resolve';

const regions = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: { code: '75' },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[2.2, 48.8],
						[2.4, 48.8],
						[2.4, 48.9],
						[2.2, 48.8],
					],
				],
			},
		},
	],
};

let root: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-map-boundary-files-test-'));
	useBackend('local', root);
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(root, { recursive: true, force: true });
});

describe('uploaded map boundaries', () => {
	it('keeps the GeoJSON in project storage, outside user spaces, and serves it by key', async () => {
		const stored = await saveBoundaryFile('proj-1', { fileName: 'regions.geojson', geojson: regions });
		const set = boundarySet(stored.file);

		expect(stored.featureCount).toBe(1);
		expect(stored.file.storageKey).toMatch(/^projects\/proj-1\/map-boundaries\/[\w-]+\.geojson$/);
		expect(await loadBoundarySet('paris', [set])).toEqual({ geojson: regions, joinProps: ['code'] });
	});

	it('no longer serves a set once its file is deleted', async () => {
		const stored = await saveBoundaryFile('proj-1', { fileName: 'regions.geojson', geojson: regions });

		await deleteBoundaryFile(stored.file);

		expect(await loadBoundarySet('paris', [boundarySet(stored.file)])).toBeNull();
	});

	it('refuses an upload when permanent storage is turned off', async () => {
		useBackend('none');

		await expect(saveBoundaryFile('proj-1', { fileName: 'regions.geojson', geojson: regions })).rejects.toThrow(
			STORAGE_DISABLED_MESSAGE,
		);
	});

	it('refuses a file that is not GeoJSON', async () => {
		await expect(saveBoundaryFile('proj-1', { fileName: 'data.json', geojson: { rows: [] } })).rejects.toThrow(
			'Not a valid GeoJSON',
		);
	});
});

function boundarySet(file: CustomBoundarySet['file']): CustomBoundarySet {
	return { key: 'paris', label: 'Paris', file, joinProperty: 'code', regionKeyHint: 'Department code' };
}

function useBackend(backend: 'none' | 'local', localPath?: string): void {
	process.env.NAO_STORAGE_BACKEND = backend;
	if (localPath) {
		process.env.NAO_STORAGE_LOCAL_PATH = localPath;
	}
	__reloadEnvForTesting();
	__resetStorageForTesting();
}
