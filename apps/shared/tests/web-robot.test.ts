import { describe, expect, it } from 'vitest';

import { webRobotRecipeSchema } from '../src/web-robot';

const minimalRecipe = {
	version: 1,
	allowedHosts: ['www.example.com'],
	stages: [
		{
			id: 'products',
			source: { type: 'http', url: 'https://www.example.com/products' },
			extract: {
				type: 'dom',
				itemSelector: '.product',
				fields: {
					name: { selector: 'h2', required: true },
					url: { selector: 'a', attr: 'href', transforms: ['absoluteUrl'] },
				},
			},
			output: 'product',
		},
	],
};

describe('webRobotRecipeSchema', () => {
	it('accepts a minimal deterministic recipe and applies defaults', () => {
		const recipe = webRobotRecipeSchema.parse(minimalRecipe);

		expect(recipe.request.concurrency).toBe(1);
		expect(recipe.request.delayMs).toBe(500);
		expect(recipe.limits.maxItems).toBe(10_000);
		expect(recipe.publish.minItems).toBe(1);
		expect(recipe.respectRobotsTxt).toBe(false);
	});

	it('accepts api and browser pipeline stages', () => {
		const recipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['www.deublin.com'],
			stages: [
				{
					id: 'selector',
					source: {
						type: 'browser',
						url: 'https://www.deublin.com/de/produkt-selektor',
						actions: [{ type: 'waitForSelector', selector: '[data-application]' }],
						capture: [{ name: 'products', urlPattern: '/catalog/productList', body: 'json' }],
					},
					extract: {
						type: 'network',
						capture: 'products',
						itemsPath: 'result',
						fields: { sku: { path: 'mpn' }, url: { path: 'uri' } },
					},
					emit: 'products',
				},
				{
					id: 'details',
					forEach: { from: 'products', limit: 2 },
					source: { type: 'http', url: '{{ products.url }}' },
					extract: {
						type: 'dom',
						fields: { name: { selector: 'h1', required: true } },
					},
					output: 'product',
				},
			],
		});

		expect(recipe.stages).toHaveLength(2);
		expect(recipe.stages[0]?.source.type).toBe('browser');
		expect(recipe.stages[1]?.forEach?.from).toBe('products');
	});

	it('allows click and scroll pagination only for browser sources', () => {
		const browserStage = {
			...minimalRecipe.stages[0],
			source: { type: 'browser', url: 'https://www.example.com/products' },
			paginate: { type: 'click', selector: 'button.next' },
		};
		const accepted = webRobotRecipeSchema.parse({ ...minimalRecipe, stages: [browserStage] });
		expect(accepted.stages[0]?.paginate).toMatchObject({ type: 'click', waitMs: 500 });

		const scrollRecipe = webRobotRecipeSchema.parse({
			...minimalRecipe,
			stages: [{ ...browserStage, paginate: { type: 'scroll' } }],
		});
		expect(scrollRecipe.stages[0]?.paginate).toMatchObject({ type: 'scroll', waitMs: 1_000 });

		const rejected = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [{ ...minimalRecipe.stages[0], paginate: { type: 'scroll' } }],
		});
		expect(rejected.success).toBe(false);
		expect(rejected.error?.issues.some((issue) => issue.message.includes('browser source'))).toBe(true);
	});

	it('accepts POST API sources with cursor and offset pagination templates', () => {
		const cursorRecipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['api.example.com'],
			stages: [
				{
					id: 'products',
					source: {
						type: 'api',
						url: 'https://api.example.com/graphql',
						method: 'POST',
						body: { query: 'query Products($cursor: String)', variables: { cursor: '{{cursor}}' } },
					},
					paginate: { type: 'cursor', nextCursorPath: 'data.products.pageInfo.endCursor', maxPages: 10 },
					extract: { type: 'json', itemsPath: 'data.products.nodes', fields: { url: { path: 'url' } } },
					output: 'product',
				},
			],
		});
		expect(cursorRecipe.stages[0]?.source).toMatchObject({ method: 'POST' });
		expect(cursorRecipe.stages[0]?.paginate).toMatchObject({ cursorVariable: 'cursor' });
		expect(cursorRecipe.stages[0]?.paginate).not.toHaveProperty('firstCursor');

		const offsetRecipe = webRobotRecipeSchema.parse({
			version: 1,
			allowedHosts: ['api.example.com'],
			stages: [
				{
					id: 'products',
					source: {
						type: 'api',
						url: 'https://api.example.com/products',
						query: { offset: '{{offset}}', limit: 50 },
					},
					paginate: { type: 'offset', pageSize: 50, totalPath: 'total' },
					extract: { type: 'json', itemsPath: 'items', fields: { url: { path: 'url' } } },
					output: 'product',
				},
			],
		});
		expect(offsetRecipe.stages[0]?.paginate).toMatchObject({
			offsetVariable: 'offset',
			firstOffset: 0,
			pageSize: 50,
		});
	});

	it('rejects cursor pagination on browser sources', () => {
		const result = webRobotRecipeSchema.safeParse({
			version: 1,
			allowedHosts: ['api.example.com'],
			stages: [
				{
					id: 'products',
					source: { type: 'browser', url: 'https://api.example.com/products' },
					paginate: { type: 'cursor', nextCursorPath: 'pageInfo.endCursor' },
					output: 'product',
				},
			],
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues.some((issue) => issue.message.includes('HTTP or API'))).toBe(true);
	});

	it('rejects duplicate stage ids', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [minimalRecipe.stages[0], minimalRecipe.stages[0]],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain('Duplicate stage id');
	});

	it('rejects a stage that consumes an unknown stage', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					forEach: { from: 'missing' },
				},
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain('unknown or later stage');
	});

	it('rejects self-referencing stages and colliding stream names', () => {
		const stage = { ...minimalRecipe.stages[0], forEach: { from: 'products' }, emit: 'products' } as Record<
			string,
			unknown
		>;
		const selfReference = webRobotRecipeSchema.safeParse({ ...minimalRecipe, stages: [stage] });
		expect(selfReference.success).toBe(false);
		expect(selfReference.error?.issues.some((issue) => issue.message.includes('unknown or later stage'))).toBe(
			true,
		);

		const collision = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [minimalRecipe.stages[0], { ...minimalRecipe.stages[0], id: 'copy', emit: 'products' }],
		});
		expect(collision.success).toBe(false);
		expect(collision.error?.issues.some((issue) => issue.message.includes('Duplicate stage stream'))).toBe(true);
	});

	it('requires one product output stage', () => {
		const stage = { ...minimalRecipe.stages[0] } as Record<string, unknown>;
		delete stage.output;

		const result = webRobotRecipeSchema.safeParse({ ...minimalRecipe, stages: [stage] });

		expect(result.success).toBe(false);
		expect(result.error?.issues.some((issue) => issue.message.includes('output'))).toBe(true);
	});

	it('accepts embedded extraction filters and ordered DOM fallbacks', () => {
		const recipe = webRobotRecipeSchema.parse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					extract: {
						type: 'embedded',
						sources: ['scriptJson'],
						itemsPath: 'state.results',
						where: [{ path: 'resultType', in: ['PRODUCT', 'PRODUCT_VARIANT'] }],
						fields: {
							sku: { path: 'sku', required: true },
							url: { path: 'url', transforms: ['absoluteUrl'] },
						},
					},
				},
			],
		});
		const extract = recipe.stages[0]?.extract;
		expect(extract?.type).toBe('embedded');
		if (extract?.type === 'embedded') {
			expect(extract.where[0]).toEqual({ path: 'resultType', in: ['PRODUCT', 'PRODUCT_VARIANT'] });
		}

		const fallback = webRobotRecipeSchema.parse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					extract: {
						type: 'dom',
						itemSelector: '.legacy-product',
						itemSelectors: ['[data-testid="product-card"]'],
						itemFingerprint: {
							tag: 'article',
							attributes: { 'data-product': 'true' },
							classes: ['legacy-product'],
							childTags: ['a'],
						},
						fields: {
							name: {
								selector: '.missing',
								selectors: ['.card-title'],
								fingerprint: { tag: 'h2', attributes: {}, classes: [], childTags: [] },
								required: true,
							},
						},
					},
				},
			],
		});
		const dom = fallback.stages[0]?.extract;
		expect(dom?.type === 'dom' ? dom.itemSelectors : undefined).toEqual(['[data-testid="product-card"]']);
		expect(dom?.type === 'dom' ? dom.itemFingerprint?.tag : undefined).toBe('article');
	});

	it('rejects record filters without a predicate', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					extract: {
						type: 'json',
						itemsPath: 'items',
						where: [{ path: 'type' }],
						fields: { name: { path: 'name' } },
					},
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it('accepts nested DOM fields and join transforms for detail rows and documents', () => {
		const recipe = webRobotRecipeSchema.parse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					extract: {
						type: 'dom',
						fields: {
							description: {
								selector: 'ul li',
								multiple: true,
								transforms: ['normalizeWhitespace', { type: 'join', separator: '\n' }],
							},
							documents: {
								each: '.download-card',
								fields: {
									name: { selector: '.title', required: true },
									url: { selector: 'a', attr: 'href', transforms: ['absoluteUrl'], required: true },
									type: { selector: '.kind' },
								},
							},
						},
					},
				},
			],
		});

		const documents =
			recipe.stages[0]?.extract?.type === 'dom' ? recipe.stages[0].extract.fields.documents : undefined;
		expect(documents?.each).toBe('.download-card');
		expect(documents?.fields?.url?.attr).toBe('href');
	});

	it('requires network extraction to reference a browser capture', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [
				{
					id: 'products',
					source: { type: 'browser', url: 'https://www.example.com/products' },
					extract: { type: 'network', capture: 'missing', fields: { name: { path: 'name' } } },
					output: 'product',
				},
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues.some((issue) => issue.message.includes('Unknown network capture'))).toBe(true);
	});

	it('rejects non-http protocols and unsafe host lists', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			allowedHosts: ['localhost'],
		});

		expect(result.success).toBe(false);
	});

	it('requires sensitive headers to reference environment variables', () => {
		const result = webRobotRecipeSchema.safeParse({
			...minimalRecipe,
			stages: [
				{
					...minimalRecipe.stages[0],
					source: {
						...minimalRecipe.stages[0].source,
						headers: { authorization: 'Bearer secret' },
					},
				},
			],
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain('env');
	});
});
