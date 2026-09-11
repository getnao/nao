import { webRobotRecipeSchema } from '@nao/shared/web-robot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebRobotBrowserSession } from '../src/services/web-scraper/browser-loader';
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
			respectRobotsTxt: true,
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

	it('renders cursor pagination into POST API request bodies', async () => {
		const seenCursors: string[] = [];
		vi.mocked(fetch).mockImplementation(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { cursor?: string } };
			const cursor = body.variables?.cursor ?? '';
			seenCursors.push(cursor);
			return jsonResponse({
				data: {
					products: {
						nodes: [{ url: `/products/${cursor || 'first'}` }],
						pageInfo: { endCursor: cursor === 'cursor-2' ? '' : `cursor-${seenCursors.length}` },
					},
				},
			});
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['api.example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: {
						type: 'api',
						url: 'https://api.example.com/graphql',
						method: 'POST',
						body: {
							query: 'query Products($cursor: String)',
							variables: { cursor: '{{cursor}}' },
						},
					},
					paginate: {
						type: 'cursor',
						nextCursorPath: 'data.products.pageInfo.endCursor',
						maxPages: 5,
					},
					extract: {
						type: 'json',
						itemsPath: 'data.products.nodes',
						fields: { url: { path: 'url', transforms: ['absoluteUrl'], required: true } },
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(seenCursors).toEqual(['', 'cursor-1', 'cursor-2']);
		expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('POST');
		expect(result.products.map((product) => product.source_url)).toEqual([
			'https://api.example.com/products/first',
			'https://api.example.com/products/cursor-1',
			'https://api.example.com/products/cursor-2',
		]);
	});

	it('renders offset pagination into API query parameters', async () => {
		const seenOffsets: number[] = [];
		vi.mocked(fetch).mockImplementation(async (input) => {
			const offset = Number(new URL(String(input)).searchParams.get('offset'));
			seenOffsets.push(offset);
			return jsonResponse({
				total: 3,
				items: [{ url: `/products/${offset}` }],
			});
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['api.example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: {
						type: 'api',
						url: 'https://api.example.com/products',
						query: { offset: '{{offset}}', limit: 1 },
					},
					paginate: { type: 'offset', pageSize: 1, totalPath: 'total', maxPages: 10 },
					extract: {
						type: 'json',
						itemsPath: 'items',
						fields: { url: { path: 'url', transforms: ['absoluteUrl'], required: true } },
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(seenOffsets).toEqual([0, 1, 2]);
		expect(result.products.map((product) => product.source_url)).toEqual([
			'https://api.example.com/products/0',
			'https://api.example.com/products/1',
			'https://api.example.com/products/2',
		]);
	});

	it('emits deduplicated warnings when DOM and pagination fallbacks are used', async () => {
		vi.mocked(fetch).mockImplementation(
			async () =>
				new Response(
					`<main>
						<article class="card"><a href="/p/a"><span class="title">Product A</span></a></article>
						<a class="pagination-next" href="/products?page=2">Next</a>
					</main>`,
					{ status: 200, headers: { 'content-type': 'text/html' } },
				),
		);
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					paginate: {
						type: 'nextLink',
						selector: 'a.missing-next',
						selectors: ['a.pagination-next'],
						attr: 'href',
						maxPages: 2,
					},
					extract: {
						type: 'dom',
						itemSelector: '.missing-item',
						itemSelectors: ['.card'],
						fields: {
							name: { selector: '.missing-name', selectors: ['.title'], required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.products.map((product) => product.name)).toEqual(['Product A']);
		expect(result.stats.fieldCoverage?.url).toBe(100);
		expect(result.stats.warnings).toHaveLength(4);
		expect(result.events.filter((event) => event.type === 'warning').map((event) => event.data)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'selector_fallback', field: 'itemSelector', fallback: '.card' }),
				expect.objectContaining({ kind: 'selector_fallback', field: 'name', fallback: '.title' }),
				expect.objectContaining({ kind: 'pagination_fallback', fallback: 'a.pagination-next' }),
				expect.objectContaining({ kind: 'pagination_stopped' }),
			]),
		);
	});

	it('relocates items and fields by element fingerprint after class changes', async () => {
		vi.mocked(fetch).mockImplementation(
			async () =>
				new Response(
					`<main>
						<article data-product="true" class="renamed-card"><a href="/p/a"><span data-field="name" class="renamed-name">Product A</span></a></article>
						<article data-product="true" class="renamed-card"><a href="/p/b"><span data-field="name" class="renamed-name">Product B</span></a></article>
					</main>`,
					{ status: 200, headers: { 'content-type': 'text/html' } },
				),
		);
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					extract: {
						type: 'dom',
						itemSelector: '.old-card',
						itemFingerprint: {
							tag: 'article',
							attributes: { 'data-product': 'true' },
							classes: ['old-card'],
							childTags: ['a'],
						},
						fields: {
							name: {
								selector: '.old-name',
								fingerprint: {
									tag: 'span',
									attributes: { 'data-field': 'name' },
									classes: ['old-name'],
									childTags: [],
								},
								required: true,
							},
							url: {
								selector: '.old-link',
								fingerprint: {
									tag: 'a',
									attributes: { href: '/p/a' },
									classes: [],
									childTags: ['span'],
								},
								attr: 'href',
								required: true,
								transforms: ['absoluteUrl'],
							},
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.products.map((product) => product.name)).toEqual(['Product A', 'Product B']);
		expect(result.products.map((product) => product.source_url)).toEqual([
			'https://example.com/p/a',
			'https://example.com/p/b',
		]);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({
						kind: 'selector_fallback',
						field: 'itemSelector',
						relocated: true,
					}),
				}),
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({ kind: 'selector_fallback', field: 'name', relocated: true }),
				}),
			]),
		);
	});

	it('relocates a next-page control by fingerprint', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			return new Response(
				url.includes('page=2')
					? '<main><div class="card"><a href="/p/b">Product B</a></div></main>'
					: `<main>
						<div class="card"><a href="/p/a">Product A</a></div>
						<a data-role="next" class="renamed-next" href="/products?page=2">Next</a>
					</main>`,
				{ status: 200, headers: { 'content-type': 'text/html' } },
			);
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					paginate: {
						type: 'nextLink',
						selector: '.old-next',
						fingerprint: {
							tag: 'a',
							attributes: { 'data-role': 'next' },
							classes: ['old-next'],
							childTags: [],
							text: 'Next',
						},
						attr: 'href',
						maxPages: 2,
					},
					extract: {
						type: 'dom',
						itemSelector: '.card',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.products.map((product) => product.name)).toEqual(['Product A', 'Product B']);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({
						kind: 'pagination_fallback',
						fallback: 'fingerprint:a',
						relocated: true,
					}),
				}),
			]),
		);
	});

	it('does not relocate pagination to an unrelated link element', async () => {
		const fetched: string[] = [];
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			fetched.push(url);
			return new Response(
				`<html><head><link rel="apple-touch-icon" href="https://example.com/icon.png" /></head>
					<main><div class="card"><a href="/p/a">Product A</a></div></main></html>`,
				{ status: 200, headers: { 'content-type': 'text/html' } },
			);
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					paginate: {
						type: 'nextLink',
						selector: 'link[rel="next"]',
						fingerprint: {
							tag: 'link',
							attributes: { rel: 'next', href: 'https://example.com/products/page/2/' },
							classes: [],
							childTags: [],
						},
						attr: 'href',
						maxPages: 10,
					},
					extract: {
						type: 'dom',
						itemSelector: '.card',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(fetched).toEqual(['https://example.com/products']);
		expect(result.products.map((product) => product.name)).toEqual(['Product A']);
		expect(result.events.filter((event) => event.type === 'warning')).toEqual([]);
	});

	it('stops pagination when the next page URL was already visited', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			const first = url.endsWith('/products');
			return new Response(
				`<main>
					<div class="card"><a href="/p/${first ? 'a' : 'b'}">Product ${first ? 'A' : 'B'}</a></div>
					<a class="next" href="https://example.com/${first ? 'products/2' : 'products'}">Next</a>
				</main>`,
				{ status: 200, headers: { 'content-type': 'text/html' } },
			);
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					paginate: { type: 'nextLink', selector: 'a.next', attr: 'href', maxPages: 10 },
					extract: {
						type: 'dom',
						itemSelector: '.card',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.stats.pagesFetched).toBe(2);
		expect(result.products.map((product) => product.name)).toEqual(['Product A', 'Product B']);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({ kind: 'pagination_stopped' }),
				}),
			]),
		);
	});

	it('stops pagination when the next page returns non-HTML content', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith('/icon.png')) {
				return new Response('PNG', { status: 200, headers: { 'content-type': 'image/png' } });
			}
			return new Response(
				`<main>
					<div class="card"><a href="/p/a">Product A</a></div>
					<a class="next" href="https://example.com/icon.png">Next</a>
				</main>`,
				{ status: 200, headers: { 'content-type': 'text/html' } },
			);
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					paginate: { type: 'nextLink', selector: 'a.next', attr: 'href', maxPages: 10 },
					extract: {
						type: 'dom',
						itemSelector: '.card',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.stats.pagesFetched).toBe(2);
		expect(result.stats.extractionErrors).toBe(0);
		expect(result.products.map((product) => product.name)).toEqual(['Product A']);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({ kind: 'pagination_stopped' }),
				}),
			]),
		);
	});

	it('emits a blocker warning when a scheduled source returns a challenge page', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response('<title>Attention Required</title><main>Please complete the CAPTCHA.</main>', {
				status: 403,
				headers: { 'content-type': 'text/html' },
			}),
		);
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'http', url: 'https://example.com/products' },
					extract: { type: 'dom', fields: { name: { selector: 'h1' } } },
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(result.stats.warnings).toEqual(
			expect.arrayContaining([expect.stringContaining('CAPTCHA'), expect.stringContaining('denied access')]),
		);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: 'warning', data: expect.objectContaining({ blocker: 'captcha' }) }),
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({ blocker: 'access_denied' }),
				}),
			]),
		);
	});

	it('dry-runs a paginated API listing with a bounded HTTP detail stage', async () => {
		const fetchMock = vi.mocked(fetch);
		const detailUrls: string[] = [];
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith('/robots.txt')) {
				return new Response('not found', { status: 404 });
			}
			if (url.startsWith('https://example.com/catalog')) {
				const query = JSON.parse(new URL(url).searchParams.get('query') ?? '{}') as { searchPage?: number };
				const page = query.searchPage ?? 1;
				return jsonResponse({
					result: Array.from({ length: 4 }, (_, index) => ({
						mpn: `P-${page}-${index + 1}`,
						uri: `/products/P-${page}-${index + 1}`,
						imageUri: `/images/P-${page}-${index + 1}.jpg`,
					})),
					numberOfPages: 8,
				});
			}
			detailUrls.push(url);
			const sku = url.split('/').pop();
			return new Response(
				`<main>
					<h1>Product ${sku}</h1><h2>${sku}</h2>
					<ul class="list"><li> First feature </li><li>Second feature</li></ul>
					<div class="attribute-row"><div class="name">Pressure</div><div><span>10 bar</span><span class="hidden">150 psi</span></div></div>
					<div class="download-card"><div class="title">Manual</div><div class="description">Install guide</div><a href="/docs/${sku}.pdf">pdf - 2 MB</a></div>
				</main>`,
				{ status: 200, headers: { 'content-type': 'text/html' } },
			);
		});

		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			identity: { fields: ['sku'] },
			request: { delayMs: 0, retries: 0, concurrency: 2 },
			stages: [
				{
					id: 'catalogue',
					source: {
						type: 'api',
						url: 'https://example.com/catalog/productList',
						query: {
							query: '{"language":"de","searchPage":{{cataloguePage}},"activeFilters":null,"sortings":null}',
						},
					},
					paginate: {
						type: 'page',
						pageVariable: 'cataloguePage',
						firstPage: 1,
						totalPagesPath: 'numberOfPages',
						maxPages: 8,
					},
					extract: {
						type: 'json',
						itemsPath: 'result',
						fields: {
							sku: { path: 'mpn', required: true },
							url: { path: 'uri', transforms: ['absoluteUrl'], required: true },
							image_url: { path: 'imageUri', transforms: ['absoluteUrl'] },
						},
					},
					emit: 'products',
				},
				{
					id: 'details',
					forEach: { from: 'products' },
					source: { type: 'http', url: '{{ products.url }}' },
					extract: {
						type: 'dom',
						fields: {
							name: { selector: 'h1', required: true },
							sku: { selector: 'main h2', required: true },
							description: {
								selector: 'ul.list li',
								multiple: true,
								transforms: ['normalizeWhitespace', { type: 'join', separator: '\n' }],
							},
							attributes: {
								each: '.attribute-row',
								fields: {
									name: { selector: '.name', required: true },
									value: { selector: 'div:last-child span:not(.hidden)', required: true },
								},
							},
							documents: {
								each: '.download-card',
								fields: {
									name: { selector: '.title', required: true },
									description: { selector: '.description' },
									url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
									type: {
										selector: 'a',
										transforms: [{ type: 'regex', pattern: '^([a-z]+)', group: 1 }],
									},
								},
							},
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe, dryRun: true, runId: 'dry_run' });

		expect(result.stageRecords.get('products')).toHaveLength(12);
		expect(result.stageRecords.get('details')).toHaveLength(3);
		expect(detailUrls).toHaveLength(3);
		expect(result.stats.pagesFetched).toBe(6);
		expect(result.stats.itemsExtracted).toBe(15);
		expect(result.products.map((product) => product.sku)).toEqual(['P-1-1', 'P-1-2', 'P-1-3']);
		expect(result.products[0]?.name).toBe('Product P-1-1');
		expect(result.products[0]?.description).toBe('First feature\nSecond feature');
		expect(result.normalized.attributes).toEqual([
			expect.objectContaining({
				product_key: result.products[0]?.product_key,
				name: 'Pressure',
				value: '10 bar',
			}),
			expect.objectContaining({
				product_key: result.products[1]?.product_key,
				name: 'Pressure',
				value: '10 bar',
			}),
			expect.objectContaining({
				product_key: result.products[2]?.product_key,
				name: 'Pressure',
				value: '10 bar',
			}),
		]);
		expect(result.normalized.documents[0]).toEqual(
			expect.objectContaining({
				title: 'Manual',
				url: 'https://example.com/docs/P-1-1.pdf',
				document_type: 'pdf',
			}),
		);
	});

	it('extracts every page returned by click pagination', async () => {
		vi.spyOn(WebRobotBrowserSession.prototype, 'loadPaginated').mockImplementation(async (_source, options) => {
			options.onWarning?.({
				kind: 'pagination_fallback',
				selector: 'button[data-testid="next"]',
				fallback: 'button[aria-label="Next"]',
				message: 'Pagination selector fallback was used.',
			});
			return [
				{
					url: 'https://example.com/search',
					finalUrl: 'https://example.com/search',
					status: 200,
					bodyText:
						'<div class="item"><a href="/p/a-1">A 1</a></div><div class="item"><a href="/p/a-2">A 2</a></div>',
					captures: [],
					requests: 2,
				},
				{
					url: 'https://example.com/search',
					finalUrl: 'https://example.com/search?page=1',
					status: 200,
					bodyText:
						'<div class="item"><a href="/p/b-1">B 1</a></div><div class="item"><a href="/p/b-2">B 2</a></div>',
					captures: [],
					requests: 1,
				},
			];
		});
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'browser', url: 'https://example.com/search' },
					paginate: { type: 'click', selector: 'button[data-testid="next"]', maxPages: 3 },
					extract: {
						type: 'dom',
						itemSelector: '.item',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(WebRobotBrowserSession.prototype.loadPaginated).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'browser', url: 'https://example.com/search' }),
			expect.objectContaining({ recipe }),
			expect.objectContaining({ selector: 'button[data-testid="next"]', maxPages: 3 }),
		);
		expect(result.products.map((product) => product.name)).toEqual(['A 1', 'A 2', 'B 1', 'B 2']);
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'warning',
					data: expect.objectContaining({ kind: 'pagination_fallback' }),
				}),
			]),
		);
		expect(result.stats.pagesFetched).toBe(2);
		expect(result.stats.requests).toBe(3);
	});

	it('extracts every snapshot returned by scroll pagination', async () => {
		vi.spyOn(WebRobotBrowserSession.prototype, 'loadPaginated').mockResolvedValue([
			{
				url: 'https://example.com/search',
				finalUrl: 'https://example.com/search',
				status: 200,
				bodyText: '<div class="item"><a href="/p/a-1">A 1</a></div>',
				captures: [],
				requests: 1,
			},
			{
				url: 'https://example.com/search',
				finalUrl: 'https://example.com/search',
				status: 200,
				bodyText:
					'<div class="item"><a href="/p/a-1">A 1</a></div><div class="item"><a href="/p/b-1">B 1</a></div>',
				captures: [],
				requests: 1,
			},
		]);
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['example.com'],
			request: { delayMs: 0, retries: 0 },
			stages: [
				{
					id: 'products',
					source: { type: 'browser', url: 'https://example.com/search' },
					paginate: { type: 'scroll', waitMs: 200, maxPages: 3 },
					extract: {
						type: 'dom',
						itemSelector: '.item',
						fields: {
							name: { selector: 'a', required: true },
							url: { selector: 'a', attr: 'href', required: true, transforms: ['absoluteUrl'] },
						},
					},
					output: 'product',
				},
			],
		});

		const result = await runWebRobotRecipe({ recipe });

		expect(WebRobotBrowserSession.prototype.loadPaginated).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'browser' }),
			expect.objectContaining({ recipe }),
			expect.objectContaining({ type: 'scroll', waitMs: 200, maxPages: 3 }),
		);
		expect(result.products.map((product) => product.name)).toEqual(['A 1', 'B 1']);
		expect(result.stats.pagesFetched).toBe(2);
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
