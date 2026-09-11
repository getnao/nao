import { describe, expect, it } from 'vitest';

import { extractDomRecords, findNextLink } from '../src/services/web-scraper/extract-dom';
import { extractEmbeddedRecords } from '../src/services/web-scraper/extract-embedded';
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

	it('uses ordered item and field selector fallbacks', () => {
		const html = `
			<div data-testid="product-card"><a class="product-link" href="/p/a"><span class="card-title">Alpha</span></a></div>
			<div data-testid="product-card"><a class="product-link" href="/p/b"><span class="card-title">Beta</span></a></div>`;
		const rows = extractDomRecords(
			html,
			{
				type: 'dom',
				itemSelector: '.legacy-product',
				itemSelectors: ['[data-testid="product-card"]'],
				fields: {
					url: {
						selector: '.missing-link',
						selectors: ['a.product-link'],
						attr: 'href',
						transforms: ['absoluteUrl'],
						format: 'text',
						multiple: false,
						required: false,
					},
					name: {
						selector: '.missing-name',
						selectors: ['.card-title'],
						format: 'text',
						multiple: false,
						required: true,
						transforms: ['normalizeWhitespace'],
					},
				},
			},
			'https://example.com/catalog',
		);

		expect(rows).toEqual([
			{ url: 'https://example.com/p/a', name: 'Alpha' },
			{ url: 'https://example.com/p/b', name: 'Beta' },
		]);
	});

	it('extracts nested repeated fields for attributes and documents', () => {
		const html = `
			<div class="row"><div><span>Pressure</span></div><div><span>10 bar</span><span class="hidden">150 psi</span></div></div>
			<div class="download-card"><div class="title">Manual</div><div class="description">Install guide</div><a href="/docs/manual.pdf">pdf - 2 MB</a></div>`;
		const rows = extractDomRecords(
			html,
			{
				type: 'dom',
				fields: {
					attributes: {
						each: '.row',
						format: 'text',
						multiple: false,
						required: false,
						transforms: [],
						fields: {
							name: {
								selector: 'div:first-child',
								format: 'text',
								multiple: false,
								required: true,
								transforms: ['normalizeWhitespace'],
							},
							value: {
								selector: 'div:last-child span:not(.hidden)',
								format: 'text',
								multiple: false,
								required: true,
								transforms: ['normalizeWhitespace'],
							},
						},
					},
					documents: {
						each: '.download-card',
						format: 'text',
						multiple: false,
						required: false,
						transforms: [],
						fields: {
							name: {
								selector: '.title',
								format: 'text',
								multiple: false,
								required: true,
								transforms: [],
							},
							description: {
								selector: '.description',
								format: 'text',
								multiple: false,
								required: false,
								transforms: [],
							},
							url: {
								selector: 'a',
								attr: 'href',
								format: 'text',
								multiple: false,
								required: true,
								transforms: ['absoluteUrl'],
							},
							type: {
								selector: 'a',
								format: 'text',
								multiple: false,
								required: false,
								transforms: [{ type: 'regex', pattern: '^([a-z]+)', group: 1 }],
							},
						},
					},
				},
			},
			'https://example.com/products/a-1',
		);

		expect(rows).toEqual([
			{
				attributes: [{ name: 'Pressure', value: '10 bar' }],
				documents: [
					{
						name: 'Manual',
						description: 'Install guide',
						url: 'https://example.com/docs/manual.pdf',
						type: 'pdf',
					},
				],
			},
		]);
	});

	it('finds the next pagination link', () => {
		expect(
			findNextLink(
				'<a rel="next" href="/catalog?page=2">Next</a>',
				'.missing-next',
				'href',
				'https://example.com',
				['a[rel="next"]'],
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
				where: [],
				fields: {
					sku: { path: 'mpn', required: true, multiple: false, transforms: [] },
					url: { path: 'uri', transforms: ['absoluteUrl'], required: false, multiple: false },
				},
			},
			'https://www.deublin.com/catalog/productList',
		);
		expect(rows).toEqual([{ sku: '57-000-001', url: 'https://www.deublin.com/de/produkte/57' }]);
	});

	it('filters mixed result types before extracting fields', () => {
		const rows = extractJsonRecords(
			{
				result: [
					{ type: 'PRODUCT', sku: 'P-1', uri: '/p/1' },
					{ type: 'DOWNLOAD', title: 'Manual', uri: '/d/1' },
					{ type: 'PRODUCT', sku: 'P-2', uri: '/p/2' },
				],
			},
			{
				type: 'json',
				itemsPath: 'result',
				where: [{ path: 'type', equals: 'product' }],
				fields: {
					sku: { path: 'sku', required: true, multiple: false, transforms: [] },
					url: { path: 'uri', transforms: ['absoluteUrl'], required: false, multiple: false },
				},
			},
			'https://example.com/api',
		);

		expect(rows).toEqual([
			{ sku: 'P-1', url: 'https://example.com/p/1' },
			{ sku: 'P-2', url: 'https://example.com/p/2' },
		]);
	});
});

describe('web scraper embedded extraction', () => {
	it('extracts filtered products from embedded framework state', () => {
		const html = `<html><body><script>window.searchState = ${JSON.stringify({
			results: [
				{ resultType: 'PRODUCT', sku: 'P-1', name: 'Valve', url: '/p/1' },
				{ resultType: 'DOWNLOAD', title: 'Manual', url: '/d/1' },
				{ resultType: 'SERVICE', name: 'Support' },
				{ resultType: 'PRODUCT', sku: 'P-2', name: 'Pump', url: '/p/2' },
			],
		})};</script></body></html>`;

		const rows = extractEmbeddedRecords(
			html,
			{
				type: 'embedded',
				sources: ['scriptJson'],
				itemsPath: 'results',
				where: [{ path: 'resultType', in: ['PRODUCT'] }],
				fields: {
					sku: { path: 'sku', required: true, multiple: false, transforms: [] },
					name: { path: 'name', required: true, multiple: false, transforms: [] },
					url: { path: 'url', transforms: ['absoluteUrl'], required: true, multiple: false },
				},
			},
			'https://example.com/search',
		);

		expect(rows).toEqual([
			{ sku: 'P-1', name: 'Valve', url: 'https://example.com/p/1' },
			{ sku: 'P-2', name: 'Pump', url: 'https://example.com/p/2' },
		]);
	});

	it('extracts microdata products', () => {
		const html = `
			<div itemscope itemtype="https://schema.org/Product">
				<a itemprop="url" href="/p/micro"><span itemprop="name">Micro Product</span></a>
				<meta itemprop="sku" content="M-1" />
			</div>`;
		const rows = extractEmbeddedRecords(
			html,
			{
				type: 'embedded',
				sources: ['microdata'],
				where: [],
				fields: {
					name: { path: 'name', required: true, multiple: false, transforms: [] },
					sku: { path: 'sku', required: true, multiple: false, transforms: [] },
					url: { path: 'url', transforms: ['absoluteUrl'], required: true, multiple: false },
				},
			},
			'https://example.com/catalog',
		);

		expect(rows).toEqual([{ name: 'Micro Product', sku: 'M-1', url: 'https://example.com/p/micro' }]);
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

	it('expands ItemList elements into product records', () => {
		const html = `<script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'ItemList',
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					item: { '@type': 'Product', name: 'Board', url: '/p/board/12345/' },
				},
				{
					'@type': 'ListItem',
					position: 2,
					item: { '@type': 'Product', name: 'Panel', url: '/p/panel/12346/' },
				},
			],
		})}</script>`;
		expect(
			extractJsonLdRecords(
				html,
				{
					type: 'jsonld',
					schemaTypes: ['ItemList'],
					fields: {
						name: { path: 'item.name', required: true, multiple: false, transforms: [] },
						url: { path: 'item.url', transforms: ['absoluteUrl'], required: true, multiple: false },
					},
				},
				'https://example.com/catalog',
			),
		).toEqual([
			{ name: 'Board', url: 'https://example.com/p/board/12345/' },
			{ name: 'Panel', url: 'https://example.com/p/panel/12346/' },
		]);
	});
});
