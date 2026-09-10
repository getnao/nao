import { describe, expect, it } from 'vitest';

import { getPathValue, renderStringTemplate, renderTemplate } from '../src/services/web-scraper/template';

const scope = {
	products: {
		items: [{ sku: 'D-100', url: '/products/d-100' }],
		page: 2,
	},
	record: { id: 'abc' },
};

describe('web scraper templates', () => {
	it('renders nested object and array paths', () => {
		expect(
			renderStringTemplate('https://example.com{{ products.items[0].url }}?page={{ products.page }}', scope),
		).toBe('https://example.com/products/d-100?page=2');
	});

	it('renders templates recursively in request objects', () => {
		const rendered = renderTemplate(
			{ url: '{{ record.id }}', query: { page: '{{ products.page }}', tags: ['{{ products.items[0].sku }}'] } },
			scope,
		);
		expect(rendered).toEqual({ url: 'abc', query: { page: '2', tags: ['D-100'] } });
	});

	it('does not evaluate JavaScript in placeholders', () => {
		const template = '{{ products.items[0].sku.toUpperCase() }}';
		expect(renderStringTemplate(template, scope)).toBe(template);
	});

	it('reads deterministic JSON paths', () => {
		expect(getPathValue({ result: [{ mpn: '57-000-001' }] }, 'result[0].mpn')).toBe('57-000-001');
	});
});
