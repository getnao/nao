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
		expect(recipe.respectRobotsTxt).toBe(true);
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
