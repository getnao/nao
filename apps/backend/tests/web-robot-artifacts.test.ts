import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import {
	listProjectDatasetDirectory,
	readProjectDataset,
	statProjectDataset,
} from '../src/services/storage/project-datasets';
import { publishWebRobotRunArtifacts } from '../src/services/web-robot-artifacts';
import { normalizeProducts } from '../src/services/web-scraper/records';

const recipe = webRobotRecipeSchema.parse({
	version: 1,
	allowedHosts: ['example.com'],
	identity: { fields: ['sku'] },
	publish: { minItems: 1, maxRemovedPercent: 50 },
	stages: [
		{
			id: 'products',
			source: { type: 'api', url: 'https://example.com/products' },
			output: 'product',
		},
	],
});

let root: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-web-robot-artifacts-test-'));
	process.env.NAO_STORAGE_BACKEND = 'local';
	process.env.NAO_STORAGE_LOCAL_PATH = root;
	__reloadEnvForTesting();
	__resetStorageForTesting();
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(root, { recursive: true, force: true });
});

describe('web robot artifacts', () => {
	it('publishes latest products, diagnostics, schema, manifest, and README', async () => {
		const normalized = normalizeProducts(
			[
				{
					stageId: 'products',
					url: 'https://example.com/products/a-1',
					data: { sku: 'A-1', name: 'Product A', url: 'https://example.com/products/a-1' },
				},
			],
			recipe,
			'run_1',
			'2026-01-01T00:00:00.000Z',
		);

		const result = await publishWebRobotRunArtifacts({
			projectId: 'proj-1',
			robotName: 'Catalog',
			robotSlug: 'catalog',
			runId: 'run_1',
			recipe,
			definitionHash: 'hash_1',
			normalized,
			events: [
				{
					type: 'page',
					stageId: 'products',
					url: 'https://example.com/products',
					createdAt: '2026-01-01T00:00:30.000Z',
				},
			],
			stats: {
				pagesDiscovered: 1,
				pagesFetched: 1,
				requests: 1,
				itemsExtracted: 1,
				productsAdded: 0,
				productsChanged: 0,
				productsRemoved: 0,
				productsUnchanged: 0,
				extractionErrors: 0,
				errors: [],
			},
			startedAt: new Date('2026-01-01T00:00:00.000Z'),
			completedAt: new Date('2026-01-01T00:01:00.000Z'),
		});

		expect(result.published).toBe(true);
		expect(result.diff.added).toHaveLength(1);
		expect(await statProjectDataset('proj-1', 'catalog/latest/products.parquet')).not.toBeNull();
		expect(await statProjectDataset('proj-1', 'catalog/versions/run_1/products.parquet')).not.toBeNull();
		expect(await readProjectDataset('proj-1', 'catalog/latest/README.md')).toContain(
			'/datasets/catalog/latest/products.parquet',
		);
		expect(JSON.parse(await readProjectDataset('proj-1', 'catalog/latest/manifest.json'))).toMatchObject({
			runId: 'run_1',
			published: true,
			counts: { products: 1 },
		});
		expect(await listProjectDatasetDirectory('proj-1', 'catalog/latest')).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'products.jsonl' }),
				expect.objectContaining({ name: 'product_attributes.parquet' }),
				expect.objectContaining({ name: 'changes.parquet' }),
			]),
		);
	});

	it('keeps the previous latest dataset when safeguards reject a run', async () => {
		await publish('run_1', [{ sku: 'A-1', name: 'Product A', url: 'https://example.com/a-1' }]);
		const previous = await readProjectDataset('proj-1', 'catalog/latest/products.jsonl');

		const result = await publish('run_2', []);

		expect(result.published).toBe(false);
		expect(result.publishError).toContain('at least 1');
		expect(await readProjectDataset('proj-1', 'catalog/latest/products.jsonl')).toBe(previous);
		expect(JSON.parse(await readProjectDataset('proj-1', 'catalog/versions/run_2/manifest.json')).published).toBe(
			false,
		);
	});
});

const publish = async (runId: string, rows: Record<string, unknown>[]) => {
	return publishWebRobotRunArtifacts({
		projectId: 'proj-1',
		robotName: 'Catalog',
		robotSlug: 'catalog',
		runId,
		recipe,
		definitionHash: `hash_${runId}`,
		normalized: normalizeProducts(
			rows.map((data) => ({ stageId: 'products', url: String(data.url), data })),
			recipe,
			runId,
		),
		events: [],
		stats: {
			pagesDiscovered: 1,
			pagesFetched: 1,
			requests: 1,
			itemsExtracted: rows.length,
			productsAdded: 0,
			productsChanged: 0,
			productsRemoved: 0,
			productsUnchanged: 0,
			extractionErrors: 0,
			errors: [],
		},
		completedAt: new Date(),
	});
};
