import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectWebRobotSourceBlockers, discoverWebRobotSource } from '../src/services/web-robot-authoring/discovery';
import { generateDeterministicCandidates } from '../src/services/web-robot-authoring/generate';
import type { WebRobotSourceDiscovery } from '../src/services/web-robot-authoring/types';
import { WebRobotBrowserSession } from '../src/services/web-scraper/browser-loader';
import { loadHttpSource } from '../src/services/web-scraper/http-loader';
import type { WebRobotLoadedSource } from '../src/services/web-scraper/types';

vi.mock('../src/services/web-scraper/http-loader', () => ({
	loadHttpSource: vi.fn(),
}));

const discovery = (): WebRobotSourceDiscovery => ({
	url: 'https://example.com/products',
	finalUrl: 'https://example.com/products',
	allowedHosts: ['example.com'],
	apiCandidates: [],
	endpointCandidates: [],
	jsonLdCandidates: [],
	embeddedCandidates: [],
	domCandidates: [],
	detailCandidates: [],
	paginationCandidates: [],
	browserActionCandidates: [],
	blockers: [],
	warnings: [],
	errors: [],
});

const page = (html: string, status = 200, finalUrl = 'https://example.com/products') => ({
	loader: 'http' as const,
	loaded: {
		url: 'https://example.com/products',
		finalUrl,
		status,
		contentType: 'text/html',
		bodyText: html,
		captures: [],
		requests: 1,
	} satisfies WebRobotLoadedSource,
});

beforeEach(() => {
	vi.restoreAllMocks();
	vi.mocked(loadHttpSource).mockReset();
});

describe('web robot source discovery', () => {
	it('infers a sanitized POST API candidate and cursor/offset controls from captures', async () => {
		vi.mocked(loadHttpSource).mockResolvedValue({
			url: 'https://example.com/products',
			finalUrl: 'https://example.com/products',
			status: 200,
			contentType: 'text/html',
			bodyText: '<main><div id="app"></div></main>',
			captures: [],
			requests: 1,
		});
		vi.spyOn(WebRobotBrowserSession.prototype, 'load').mockResolvedValue({
			url: 'https://example.com/products',
			finalUrl: 'https://example.com/products',
			status: 200,
			contentType: 'text/html',
			bodyText:
				'<main><div class="product"><a href="/p/a">Product A</a></div><div class="product"><a href="/p/b">Product B</a></div><button class="load-more">Load more</button></main>',
			captures: [
				{
					name: 'catalogue',
					url: 'https://example.com/api/products',
					status: 200,
					requestMethod: 'POST',
					requestContentType: 'application/json',
					requestBody: {
						query: 'query Products($cursor: String)',
						variables: { cursor: 'cursor-0', offset: 0, limit: 2 },
						authToken: 'secret',
					},
					contentType: 'application/json',
					body: {
						items: [
							{ name: 'Product A', url: '/p/a', sku: 'A-1' },
							{ name: 'Product B', url: '/p/b', sku: 'B-2' },
						],
						total: 3,
						pageInfo: { endCursor: 'cursor-1' },
					},
				},
			],
			requests: 2,
		});
		vi.spyOn(WebRobotBrowserSession.prototype, 'probePagination').mockResolvedValue({
			clickSelector: 'button.load-more',
		});

		const result = await discoverWebRobotSource({
			url: 'https://example.com/products',
			env: {},
		});

		expect(result.apiCandidates[0]).toMatchObject({
			kind: 'network',
			method: 'POST',
			requestBody: {
				variables: { cursor: 'cursor-0', offset: 0, limit: 2 },
			},
		});
		expect(result.paginationCandidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'cursor', nextCursorPath: 'pageInfo.endCursor' }),
				expect.objectContaining({ type: 'offset', totalPath: 'total', pageSize: 2 }),
				expect.objectContaining({
					type: 'click',
					selector: 'button.load-more',
					observed: true,
				}),
			]),
		);

		const generatedCandidates = generateDeterministicCandidates(result);
		const generatedRecipes = generatedCandidates.map((candidate) => webRobotRecipeSchema.parse(candidate.recipe));
		const browserRecipe = generatedRecipes.find((recipe) => recipe.stages[0]?.source.type === 'browser');
		expect(browserRecipe?.stages[0]?.paginate).toMatchObject({
			type: 'click',
			selector: 'button.load-more',
		});

		const generated = generatedRecipes[0];
		expect(generated).toMatchObject({
			stages: [
				{
					source: {
						type: 'api',
						method: 'POST',
						body: {
							variables: { cursor: '{{cursor}}', offset: 0, limit: 2 },
						},
					},
				},
			],
		});
		expect(JSON.stringify(generated)).not.toContain('secret');
	});

	it('discovers and probes same-host endpoints referenced by HTML and scripts', async () => {
		vi.mocked(loadHttpSource).mockImplementation(async (source) => {
			const url = source.url;
			if (url === 'https://example.com/products') {
				return {
					url,
					finalUrl: url,
					status: 200,
					contentType: 'text/html',
					bodyText: `<main><form action="/api/search" method="get"><input name="limit" value="2" /></form><script src="/app.js"></script></main>`,
					captures: [],
					requests: 1,
				};
			}
			if (url === 'https://example.com/app.js') {
				return {
					url,
					finalUrl: url,
					status: 200,
					contentType: 'text/javascript',
					bodyText: `fetch('/api/products?page=1&authToken=secret')`,
					captures: [],
					requests: 1,
				};
			}
			if (url === 'https://example.com/api/products?page=1') {
				return {
					url,
					finalUrl: url,
					status: 200,
					contentType: 'application/json',
					bodyText: JSON.stringify({
						items: [
							{ name: 'Product A', url: '/p/a', sku: 'A-1' },
							{ name: 'Product B', url: '/p/b', sku: 'B-2' },
						],
						totalPages: 2,
					}),
					bodyJson: {
						items: [
							{ name: 'Product A', url: '/p/a', sku: 'A-1' },
							{ name: 'Product B', url: '/p/b', sku: 'B-2' },
						],
						totalPages: 2,
					},
					captures: [],
					requests: 1,
				};
			}
			return {
				url,
				finalUrl: url,
				status: 200,
				contentType: 'text/html',
				bodyText: '<main></main>',
				captures: [],
				requests: 1,
			};
		});

		const result = await discoverWebRobotSource({ url: 'https://example.com/products', env: {} });

		expect(result.apiCandidates[0]).toMatchObject({
			kind: 'api',
			url: 'https://example.com/api/products?page=1',
			itemsPath: 'items',
		});
		expect(result.paginationCandidates).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'page', totalPagesPath: 'totalPages' })]),
		);
		expect(result.endpointCandidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'script',
					url: 'https://example.com/api/products?page=1',
					probed: true,
					productCandidate: true,
				}),
				expect.objectContaining({ source: 'form', url: 'https://example.com/api/search?limit=2' }),
			]),
		);
		expect(JSON.stringify(result.endpointCandidates)).not.toContain('secret');
	});

	it('compiles observed consent dismissal and item waits into browser actions', () => {
		const source = discovery();
		source.domCandidates.push({
			loader: 'browser',
			itemSelector: '.product',
			fields: { url: { selector: 'a', attr: 'href', required: true } },
			itemCount: 2,
			productUrls: [],
			sample: {},
			score: 80,
		});
		source.browserActionCandidates.push({
			type: 'click',
			kind: 'consent',
			selector: '#accept-cookies',
			selectors: ['#accept-cookies', '[data-testid="accept"]'],
			observed: true,
		});

		const generated = generateDeterministicCandidates(source)[0];
		const recipe = webRobotRecipeSchema.parse(generated?.recipe);
		const browserSource = recipe.stages[0]?.source;

		expect(browserSource?.type).toBe('browser');
		expect(browserSource?.type === 'browser' ? browserSource.actions : []).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'click', selector: '#accept-cookies' }),
				expect.objectContaining({ type: 'waitForSelector', selector: '.product' }),
			]),
		);
	});

	it('compiles observed scroll loading into deterministic scroll pagination', () => {
		const source = discovery();
		source.domCandidates.push({
			loader: 'browser',
			itemSelector: '.product',
			itemFingerprint: {
				tag: 'article',
				attributes: { 'data-product': 'true' },
				classes: ['product'],
				childTags: ['a'],
			},
			itemCount: 3,
			productUrlCount: 3,
			fields: {
				url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
				name: { selector: 'a', required: true, transforms: ['normalizeWhitespace'] },
			},
			productUrls: ['https://example.com/p/a', 'https://example.com/p/b'],
			sample: { text: 'Product A', href: 'https://example.com/p/a' },
			score: 80,
		});
		source.paginationCandidates.push({ type: 'scroll', waitMs: 800, observed: true });

		const recipe = webRobotRecipeSchema.parse(generateDeterministicCandidates(source)[0]?.recipe);

		expect(recipe.stages[0]?.paginate).toMatchObject({ type: 'scroll', waitMs: 800 });
		expect(recipe.stages[0]?.extract).toMatchObject({
			itemFingerprint: { tag: 'article', attributes: { 'data-product': 'true' } },
		});
		expect(recipe.stages[0]?.source).toMatchObject({
			type: 'browser',
			actions: [
				{ type: 'waitForSelector', selector: '.product', timeoutMs: 5_000 },
				{ type: 'delay', ms: 1_000 },
			],
		});
	});
});

describe('web robot source blocker detection', () => {
	it('classifies captcha and bot challenge pages', () => {
		const blockers = detectWebRobotSourceBlockers(
			page('<title>Attention Required</title><main>Please complete the CAPTCHA. Cloudflare Ray ID: abc</main>'),
			discovery(),
		);

		expect(blockers.map((blocker) => blocker.kind)).toEqual(expect.arrayContaining(['captcha', 'bot_challenge']));
	});

	it('classifies login-required pages', () => {
		const blockers = detectWebRobotSourceBlockers(
			page('<form><input name="user" /><input type="password" /></form>', 200, 'https://example.com/login'),
			discovery(),
		);

		expect(blockers.some((blocker) => blocker.kind === 'login')).toBe(true);
	});

	it('classifies rate limits without requiring HTML content', () => {
		const blockers = detectWebRobotSourceBlockers(page('', 429), discovery());

		expect(blockers).toEqual([expect.objectContaining({ kind: 'rate_limited', status: 429 })]);
	});

	it('classifies empty client-side shells', () => {
		const blockers = detectWebRobotSourceBlockers(
			page('<div id="root"></div><script src="/app.js"></script>'),
			discovery(),
		);

		expect(blockers).toEqual([expect.objectContaining({ kind: 'empty_shell' })]);
	});
});
