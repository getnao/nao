import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	discoverWebRobotSource: vi.fn(),
	generateModelRecipeCandidates: vi.fn(),
	runWebRobotRecipe: vi.fn(),
}));

vi.mock('../src/services/web-robot-authoring/discovery', () => ({
	discoverWebRobotSource: mocks.discoverWebRobotSource,
}));

vi.mock('../src/services/web-robot-authoring/model', () => ({
	generateModelRecipeCandidates: mocks.generateModelRecipeCandidates,
}));

vi.mock('../src/services/web-scraper', () => ({
	runWebRobotRecipe: mocks.runWebRobotRecipe,
}));

import { authorWebRobotRecipeFromUrl } from '../src/services/web-robot-authoring';
import { sanitizeAuthoredRecipe } from '../src/services/web-robot-authoring/generate';
import { recipeRepairChanges, repairSourceUrl } from '../src/services/web-robot-authoring/repair';
import { scoreExecution } from '../src/services/web-robot-authoring/score';

const discovery = {
	url: 'https://example.com/products',
	finalUrl: 'https://example.com/products',
	allowedHosts: ['example.com'],
	title: 'Example products',
	httpStatus: 200,
	apiCandidates: [
		{
			kind: 'network' as const,
			url: 'https://example.com/api/products?query=%7B%22page%22%3A1%7D',
			method: 'GET',
			status: 200,
			captureName: 'catalogue',
			capturePattern: '*/api/products*',
			itemsPath: 'items',
			itemCount: 3,
			fields: {
				url: { path: 'url', required: true, transforms: ['absoluteUrl'] },
				sku: { path: 'sku' },
			},
			fieldNames: ['url', 'sku'],
			identityField: 'sku',
			urlField: 'url',
			productUrls: ['https://example.com/products/one'],
			sample: { url: '/products/one', sku: 'SKU-1' },
			score: 90,
		},
	],
	endpointCandidates: [],
	jsonLdCandidates: [],
	embeddedCandidates: [],
	domCandidates: [],
	detailCandidates: [],
	paginationCandidates: [{ type: 'page' as const, pageVariable: 'page', totalPagesPath: 'totalPages' }],
	browserActionCandidates: [],
	blockers: [],
	warnings: [],
	errors: [],
};

const execution = {
	stats: {
		pagesFetched: 1,
		requests: 1,
		failedRequests: 0,
		itemsExtracted: 3,
		extractionErrors: 0,
		robotsRejected: 0,
		durationMs: 100,
		errors: [],
		warnings: [],
		fieldCoverage: { url: 100, name: 100, sku: 100 },
	},
	stageRecords: new Map(),
	products: [],
	events: [],
	normalized: {
		products: [
			{ product_key: 'key:1', source_url: 'https://example.com/products/one', name: 'One', sku: 'SKU-1' },
			{ product_key: 'key:2', source_url: 'https://example.com/products/two', name: 'Two', sku: 'SKU-2' },
		],
		attributes: [],
		documents: [],
	},
};

describe('web robot URL authoring', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.discoverWebRobotSource.mockResolvedValue(discovery);
		mocks.generateModelRecipeCandidates.mockResolvedValue([]);
		mocks.runWebRobotRecipe.mockResolvedValue(execution);
	});

	it('accepts a deterministic API candidate and preserves nested page templates', async () => {
		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}
		const parsed = webRobotRecipeSchema.parse(result.recipe);
		expect(parsed.stages[0]?.source).toMatchObject({
			type: 'api',
			url: 'https://example.com/api/products',
			query: { query: { page: '{{page}}' } },
		});
		expect(parsed.stages[0]?.paginate).toMatchObject({
			type: 'page',
			totalPagesPath: 'totalPages',
		});
		expect(mocks.generateModelRecipeCandidates).not.toHaveBeenCalled();
	});

	it('compiles a sanitized POST API candidate with cursor pagination', async () => {
		mocks.discoverWebRobotSource.mockResolvedValue({
			...discovery,
			apiCandidates: [
				{
					...discovery.apiCandidates[0]!,
					kind: 'network' as const,
					method: 'POST',
					requestContentType: 'application/json',
					requestBody: {
						query: 'query Products($cursor: String)',
						variables: { cursor: 'cursor-0', limit: 20 },
						authToken: 'secret',
					},
				},
			],
			paginationCandidates: [
				{
					type: 'cursor' as const,
					cursorVariable: 'cursor',
					firstCursor: 'cursor-0',
					nextCursorPath: 'data.products.pageInfo.endCursor',
				},
			],
		});

		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('ready');
		if (result.status !== 'ready') {
			return;
		}
		const source = result.recipe.stages[0]?.source;
		expect(source).toMatchObject({
			type: 'api',
			method: 'POST',
			headers: {},
			body: {
				query: 'query Products($cursor: String)',
				variables: { cursor: '{{cursor}}', limit: 20 },
			},
		});
		expect(source).not.toHaveProperty('body.authToken');
		expect(result.recipe.stages[0]?.paginate).toMatchObject({
			type: 'cursor',
			nextCursorPath: 'data.products.pageInfo.endCursor',
		});
	});

	it('returns partial when only a first-page DOM recipe is reliable', async () => {
		mocks.discoverWebRobotSource.mockResolvedValue({
			...discovery,
			apiCandidates: [],
			domCandidates: [
				{
					loader: 'http' as const,
					itemSelector: '.product-card',
					linkSelector: 'h3 a[href]',
					itemCount: 2,
					productUrlCount: 2,
					fields: {
						url: { selector: 'h3 a[href]', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						name: { selector: 'h3 a[href]', required: true, transforms: ['normalizeWhitespace'] },
						price: { selector: '.price', transforms: ['parsePrice'] },
					},
					productUrls: ['https://example.com/products/one', 'https://example.com/products/two'],
					sample: { text: 'One', href: 'https://example.com/products/one' },
					score: 80,
				},
			],
			paginationCandidates: [{ type: 'nextLink' as const, selector: 'a.next', attr: 'href' }],
		});
		mocks.runWebRobotRecipe
			.mockRejectedValueOnce(new Error('robots.txt disallows page 2'))
			.mockRejectedValueOnce(new Error('robots.txt disallows page 2'))
			.mockResolvedValueOnce({
				...execution,
				normalized: {
					...execution.normalized,
					products: execution.normalized.products.map((product) => ({
						...product,
						price: { amount: 100, currency: 'USD' },
					})),
				},
			});

		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('partial');
		if (result.status === 'partial') {
			expect(result.recipe.stages[0]?.paginate).toBeUndefined();
			expect(result.reason).toContain('pagination');
		}
	});

	it('accepts a filtered embedded-state candidate', async () => {
		mocks.discoverWebRobotSource.mockResolvedValue({
			...discovery,
			apiCandidates: [],
			embeddedCandidates: [
				{
					loader: 'http' as const,
					pageUrl: 'https://example.com/products',
					source: 'scriptJson' as const,
					itemsPath: 'results',
					where: [{ path: 'resultType', equals: 'PRODUCT' }],
					itemCount: 2,
					fields: {
						url: { path: 'url', required: true, transforms: ['absoluteUrl'] },
						name: { path: 'name', required: true },
						sku: { path: 'sku' },
					},
					productUrls: ['https://example.com/products/one'],
					sample: { resultType: 'PRODUCT', sku: 'SKU-1' },
					score: 82,
				},
			],
			paginationCandidates: [],
		});

		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('ready');
		if (result.status === 'ready') {
			expect(result.recipe.stages[0]?.extract).toMatchObject({
				type: 'embedded',
				sources: ['scriptJson'],
				itemsPath: 'results',
				where: [{ path: 'resultType', equals: 'PRODUCT' }],
			});
		}
	});

	it('returns interactive_needed for login or challenge diagnostics', async () => {
		mocks.discoverWebRobotSource.mockResolvedValue({
			...discovery,
			apiCandidates: [],
			paginationCandidates: [],
			blockers: [
				{
					kind: 'login' as const,
					loader: 'browser' as const,
					status: 200,
					message:
						'Browser inspection: The source appears to require a sign-in before catalogue data is visible.',
				},
			],
		});

		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('interactive_needed');
		expect(result.diagnostics.discovery.blockers[0]?.kind).toBe('login');
	});

	it('rejects candidates that produce no products', async () => {
		mocks.discoverWebRobotSource.mockResolvedValue({ ...discovery, apiCandidates: [] });
		const result = await authorWebRobotRecipeFromUrl({
			projectId: 'project-id',
			url: discovery.url,
			env: {},
		});

		expect(result.status).toBe('rejected');
		expect(result.reason).toContain('quality gate');
	});

	it('sanitizes authored recipes to narrow hosts, safe actions, and conservative limits', () => {
		const parsed = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['other.example'],
			request: { concurrency: 4, delayMs: 0, timeoutMs: 120_000, retries: 5 },
			limits: {
				maxPages: 10_000,
				maxItems: 100_000,
				maxRequests: 50_000,
				maxDurationMs: 60 * 60_000,
				maxResponseBytes: 50 * 1024 * 1024,
			},
			respectRobotsTxt: false,
			identity: { fields: ['sku'] },
			stages: [
				{
					id: 'products',
					source: {
						type: 'browser',
						url: 'https://example.com/products',
						headers: { Authorization: { env: 'TOKEN' }, 'x-test': 'safe' },
						actions: [
							{ type: 'click', selector: 'button' },
							{ type: 'waitForSelector', selector: '.product' },
						],
					},
					extract: {
						type: 'dom',
						fields: { url: { selector: 'a', attr: 'href' }, sku: { selector: '.sku' } },
					},
					output: 'product',
				},
			],
		});

		const sanitized = sanitizeAuthoredRecipe(parsed, discovery);
		const source = sanitized.stages[0]?.source;
		expect(sanitized.allowedHosts).toEqual(['example.com']);
		expect(sanitized.respectRobotsTxt).toBe(false);
		expect(sanitized.request).toMatchObject({ concurrency: 1, delayMs: 500, retries: 2 });
		expect(sanitized.limits.maxPages).toBe(100);
		expect(source?.type === 'browser' ? source.headers : undefined).toEqual({});
		expect(source?.type === 'browser' ? source.actions : []).toEqual([
			{ type: 'waitForSelector', selector: '.product' },
		]);
	});

	it('summarizes repair changes and only repairs from static catalogue URLs', () => {
		const before = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					extract: {
						type: 'dom',
						itemSelector: '.old-card',
						fields: { url: { selector: 'a', attr: 'href' } },
					},
					output: 'product',
				},
			],
		});
		const after = webRobotRecipeSchema.parse({
			...before,
			stages: [
				{
					...before.stages[0],
					paginate: { type: 'nextLink', selector: 'a[rel="next"]', attr: 'href' },
					extract: {
						type: 'dom',
						itemSelector: '[data-testid="product-card"]',
						fields: { url: { selector: 'a', attr: 'href' }, name: { selector: 'h2' } },
					},
				},
			],
		});

		expect(repairSourceUrl(before)).toBe('https://example.com/products');
		expect(recipeRepairChanges(before, after).map((change) => change.kind)).toEqual(
			expect.arrayContaining(['pagination', 'extract', 'fields']),
		);
	});

	it('rejects unstable product identities and extraction failures', () => {
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			identity: { fields: ['url'] },
			stages: [
				{
					id: 'products',
					source: { type: 'api', url: 'https://example.com/api/products' },
					extract: { type: 'json', itemsPath: 'items', fields: {} },
					output: 'product',
				},
			],
		});
		expect(
			scoreExecution(recipe, {
				...execution,
				normalized: { products: [{ product_key: 'record:abc', name: 'One' }], attributes: [], documents: [] },
			}).reason,
		).toContain('stable product identity');
	});
});
