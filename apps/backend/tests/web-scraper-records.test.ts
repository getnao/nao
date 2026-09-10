import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { describe, expect, it } from 'vitest';

import { assertPublishAllowed, diffProducts } from '../src/services/web-scraper/diff';
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

describe('web robot product normalization', () => {
	it('creates stable keys, hashes, attributes, and documents', () => {
		const normalized = normalizeProducts(
			[
				{
					stageId: 'products',
					url: 'https://example.com/products/a-1',
					data: {
						name: 'Product A',
						sku: 'A-1',
						url: 'https://example.com/products/a-1#top',
						attributes: { pressure: '10 bar' },
						documents: [{ title: 'Datasheet', url: '/docs/a-1.pdf', type: 'pdf' }],
					},
				},
			],
			recipe,
			'run_1',
			'2026-01-01T00:00:00.000Z',
		);

		expect(normalized.products).toHaveLength(1);
		expect(normalized.products[0]?.product_key).toMatch(/^key:[a-f0-9]{64}$/);
		expect(normalized.products[0]?.canonical_url).toBe('https://example.com/products/a-1');
		expect(normalized.products[0]?.run_id).toBe('run_1');
		expect(normalized.attributes).toEqual([
			{
				product_key: normalized.products[0]?.product_key,
				name: 'pressure',
				value: '10 bar',
				source_url: 'https://example.com/products/a-1#top',
				run_id: 'run_1',
			},
		]);
		expect(normalized.documents[0]?.url).toBe('https://example.com/docs/a-1.pdf');
	});

	it('merges repeated records by product key', () => {
		const normalized = normalizeProducts(
			[
				{
					stageId: 'products',
					data: { sku: 'A-1', name: 'A', url: 'https://example.com/a' },
				},
				{
					stageId: 'details',
					data: { sku: 'A-1', description: 'Detailed', attributes: { pressure: '10 bar' } },
				},
			],
			recipe,
		);
		expect(normalized.products).toHaveLength(1);
		expect(normalized.products[0]?.description).toBe('Detailed');
		expect(normalized.attributes).toHaveLength(1);
	});
});

describe('web robot product diffing', () => {
	it('reports added, changed, unchanged, and removed products', () => {
		const previous = [
			{ product_key: 'a', content_hash: '1', name: 'A' },
			{ product_key: 'b', content_hash: '1', name: 'B' },
			{ product_key: 'c', content_hash: '1', name: 'C' },
		];
		const current = [
			{ product_key: 'a', content_hash: '1', name: 'A' },
			{ product_key: 'b', content_hash: '2', name: 'B2' },
			{ product_key: 'd', content_hash: '1', name: 'D' },
		];

		const diff = diffProducts(previous, current, recipe);
		expect(diff.added).toEqual(['d']);
		expect(diff.changed).toEqual(['b']);
		expect(diff.removed).toEqual(['c']);
		expect(diff.unchanged).toEqual(['a']);
	});

	it('blocks publication below minItems and above the removal threshold', () => {
		expect(() =>
			assertPublishAllowed({ added: [], removed: [], changed: [], unchanged: [], changes: [] }, [], recipe),
		).toThrow('at least 1');
		expect(() =>
			assertPublishAllowed(
				{ added: [], removed: ['a', 'b', 'c'], changed: [], unchanged: ['d'], changes: [] },
				[{ product_key: 'd' }],
				recipe,
			),
		).toThrow('would be removed');
	});
});
