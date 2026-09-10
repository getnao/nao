import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runWebRobotRecipe } from '../src/services/web-scraper/runner';

vi.mock('node:dns/promises', () => ({
	default: {
		lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
	},
}));

describe('web robot runner', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	it('runs deterministic API pagination and emits normalized products', async () => {
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith('/robots.txt')) {
				return new Response('not found', { status: 404 });
			}
			if (url.includes('page=1')) {
				return jsonResponse({
					result: [{ mpn: 'A-1', uri: '/products/a-1' }],
					numberOfPages: 2,
				});
			}
			return jsonResponse({
				result: [{ mpn: 'B-2', uri: '/products/b-2' }],
				numberOfPages: 2,
			});
		});

		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0 },
			stages: [
				{
					id: 'products',
					source: {
						type: 'api',
						url: 'https://example.com/catalog',
						query: { page: '{{ page }}' },
					},
					paginate: { type: 'page', pageVariable: 'page', firstPage: 1, totalPagesPath: 'numberOfPages' },
					extract: {
						type: 'json',
						itemsPath: 'result',
						fields: {
							sku: { path: 'mpn', required: true },
							url: { path: 'uri', transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe, runId: 'run_1' });

		expect(result.products.map((product) => product.sku)).toEqual(['A-1', 'B-2']);
		expect(result.products[0]?.run_id).toBe('run_1');
		expect(result.stats.pagesFetched).toBe(2);
		expect(result.stats.itemsExtracted).toBe(2);
		expect(result.stats.requests).toBe(2);
		expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/robots.txt'))).toBe(true);
	});

	it('keeps a stage running when one parent request fails', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith('/robots.txt')) {
				return new Response('not found', { status: 404 });
			}
			if (url.endsWith('/catalog')) {
				return jsonResponse({
					items: [
						{ sku: 'A-1', url: '/products/a-1' },
						{ sku: 'B-2', url: '/products/b-2' },
					],
				});
			}
			if (url.endsWith('/products/b-2')) {
				throw new Error('connection reset');
			}
			return new Response('<h1>Product A</h1>', { status: 200, headers: { 'content-type': 'text/html' } });
		});

		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			identity: { fields: ['sku'] },
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'list',
					source: { type: 'api', url: 'https://example.com/catalog' },
					extract: {
						type: 'json',
						itemsPath: 'items',
						fields: {
							sku: { path: 'sku' },
							url: { path: 'url', transforms: ['absoluteUrl'] },
						},
					},
					emit: 'products',
				},
				{
					id: 'details',
					forEach: { from: 'products' },
					source: { type: 'http', url: '{{ products.url }}' },
					extract: { type: 'dom', fields: { name: { selector: 'h1' } } },
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.products.map((product) => product.sku)).toEqual(['A-1']);
		expect(result.stats.failedRequests).toBe(1);
		expect(result.stats.errors[0]).toContain('connection reset');
	});

	it('blocks disallowed redirects before following them', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith('/robots.txt')) {
				return new Response('not found', { status: 404 });
			}
			return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/redirected' } });
		});

		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/start' },
					output: 'product',
				},
			],
		});

		await expect(runWebRobotRecipe({ recipe })).rejects.toThrow('not allowed');
		expect(
			vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('evil.example.com')),
		).toHaveLength(0);
	});
});

const jsonResponse = (body: unknown): Response => {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
};
