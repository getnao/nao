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

	it('tracks added, unchanged, changed, and removed products across repeated publishes', async () => {
		const first = [
			{ sku: 'A-1', name: 'Product A', url: 'https://example.com/a-1' },
			{ sku: 'B-2', name: 'Product B', url: 'https://example.com/b-2' },
		];

		const added = await publish('run_1', first);
		expect(added.diff.added).toHaveLength(2);
		expect(added.diff.unchanged).toHaveLength(0);

		const unchanged = await publish('run_2', first);
		expect(unchanged.diff.unchanged).toHaveLength(2);
		expect(unchanged.diff.added).toHaveLength(0);
		expect(unchanged.diff.changed).toHaveLength(0);
		expect(unchanged.diff.removed).toHaveLength(0);

		const changed = await publish('run_3', [{ ...first[0]!, name: 'Product A updated' }]);
		expect(changed.diff.changed).toHaveLength(1);
		expect(changed.diff.removed).toHaveLength(1);

		const changes = (await readProjectDataset('proj-1', 'catalog/latest/changes.jsonl'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ change_type: 'removed', product_key: changed.diff.removed[0] }),
				expect.objectContaining({
					change_type: 'changed',
					product_key: changed.diff.changed[0],
					field: 'name',
				}),
			]),
		);
		expect(changes.filter((change) => change.change_type === 'changed').map((change) => change.field)).toEqual([
			'name',
		]);
		expect(JSON.parse(await readProjectDataset('proj-1', 'catalog/latest/manifest.json')).counts.products).toBe(1);
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

	it('rejects runs that exceed the removed-product safeguard without replacing latest', async () => {
		const strictRecipe = webRobotRecipeSchema.parse({
			...recipe,
			publish: { minItems: 0, maxRemovedPercent: 40 },
		});
		await publish(
			'run_1',
			[
				{ sku: 'A-1', name: 'Product A', url: 'https://example.com/a-1' },
				{ sku: 'B-2', name: 'Product B', url: 'https://example.com/b-2' },
			],
			strictRecipe,
		);
		const previousLatest = await readProjectDataset('proj-1', 'catalog/latest/products.jsonl');
		const previousManifest = await readProjectDataset('proj-1', 'catalog/latest/manifest.json');

		const rejected = await publish(
			'run_2',
			[{ sku: 'A-1', name: 'Product A', url: 'https://example.com/a-1' }],
			strictRecipe,
		);

		expect(rejected.published).toBe(false);
		expect(rejected.publishError).toContain('50.0% of products would be removed');
		expect(await readProjectDataset('proj-1', 'catalog/latest/products.jsonl')).toBe(previousLatest);
		expect(await readProjectDataset('proj-1', 'catalog/latest/manifest.json')).toBe(previousManifest);
		expect(JSON.parse(await readProjectDataset('proj-1', 'catalog/versions/run_2/manifest.json')).published).toBe(
			false,
		);
	});

	it('retains only the configured number of versioned artifact runs', async () => {
		process.env.WEB_ROBOT_ARTIFACT_RETENTION_RUNS = '2';
		__reloadEnvForTesting();

		const row = { sku: 'A-1', name: 'Product A', url: 'https://example.com/a-1' };
		await publish('run_1', [row], recipe, new Date('2026-01-01T00:00:00.000Z'));
		await publish('run_2', [row], recipe, new Date('2026-01-02T00:00:00.000Z'));
		await publish('run_3', [row], recipe, new Date('2026-01-03T00:00:00.000Z'));

		const versions = await listProjectDatasetDirectory('proj-1', 'catalog/versions');
		expect(versions.map((entry) => entry.name)).toEqual(['run_2', 'run_3']);
		expect(await statProjectDataset('proj-1', 'catalog/versions/run_1/manifest.json')).toBeNull();
		expect(JSON.parse(await readProjectDataset('proj-1', 'catalog/latest/manifest.json')).runId).toBe('run_3');
	});
});

const publish = async (
	runId: string,
	rows: Record<string, unknown>[],
	publishRecipe = recipe,
	completedAt = new Date(),
) => {
	return publishWebRobotRunArtifacts({
		projectId: 'proj-1',
		robotName: 'Catalog',
		robotSlug: 'catalog',
		runId,
		recipe: publishRecipe,
		definitionHash: `hash_${runId}`,
		normalized: normalizeProducts(
			rows.map((data) => ({ stageId: 'products', url: String(data.url), data })),
			publishRecipe,
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
		completedAt,
	});
};
