import { describe, expect, it } from 'vitest';

import { extractDomRecords, findNextLink } from '../src/services/web-scraper/extract-dom';
import { extractJsonRecords } from '../src/services/web-scraper/extract-json';
import { extractJsonLdRecords } from '../src/services/web-scraper/extract-json-ld';

describe('web scraper DOM extraction', () => {
	it('extracts repeated product fields and resolves URLs', () => {
		const html = `
			<ul>
				<li class="product"><a href="/p/one"> One </a><span class="sku">A-1</span></li>
				<li class="product"><a href="/p/two">Two</a><span class="sku">B-2</span></li>
			</ul>`;
		const rows = extractDomRecords(
			html,
			{
				type: 'dom',
				itemSelector: '.product',
				fields: {
					name: { selector: 'a', transforms: ['trim'], required: true, format: 'text', multiple: false },
					url: {
						selector: 'a',
						attr: 'href',
						transforms: ['absoluteUrl'],
						format: 'text',
						multiple: false,
						required: false,
					},
					sku: { selector: '.sku', format: 'text', multiple: false, required: false, transforms: [] },
				},
			},
			'https://example.com/catalog',
		);

		expect(rows).toEqual([
			{ name: 'One', url: 'https://example.com/p/one', sku: 'A-1' },
			{ name: 'Two', url: 'https://example.com/p/two', sku: 'B-2' },
		]);
	});

	it('finds the next pagination link', () => {
		expect(
			findNextLink(
				'<a rel="next" href="/catalog?page=2">Next</a>',
				'a[rel="next"]',
				'href',
				'https://example.com',
			),
		).toBe('https://example.com/catalog?page=2');
	});
});

describe('web scraper JSON extraction', () => {
	it('extracts items from a nested API response', () => {
		const rows = extractJsonRecords(
			{ result: [{ mpn: '57-000-001', uri: '/de/produkte/57' }], numberOfPages: 14 },
			{
				type: 'json',
				itemsPath: 'result',
				fields: {
					sku: { path: 'mpn', required: true, multiple: false, transforms: [] },
					url: { path: 'uri', transforms: ['absoluteUrl'], required: false, multiple: false },
				},
			},
			'https://www.deublin.com/catalog/productList',
		);
		expect(rows).toEqual([{ sku: '57-000-001', url: 'https://www.deublin.com/de/produkte/57' }]);
	});
});

describe('web scraper JSON-LD extraction', () => {
	it('extracts Product nodes from @graph blocks', () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [{ '@type': 'Product', name: 'Rotary union', sku: 'A-1', url: '/p/a-1' }],
		})}</script>`;
		expect(
			extractJsonLdRecords(
				html,
				{
					type: 'jsonld',
					schemaTypes: ['Product'],
					fields: {
						name: { path: 'name', required: false, multiple: false, transforms: [] },
						sku: { path: 'sku', required: false, multiple: false, transforms: [] },
						url: { path: 'url', transforms: ['absoluteUrl'], required: false, multiple: false },
					},
				},
				'https://example.com/catalog',
			),
		).toEqual([{ name: 'Rotary union', sku: 'A-1', url: 'https://example.com/p/a-1' }]);
	});
});
