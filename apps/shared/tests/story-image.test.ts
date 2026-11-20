import { describe, expect, it, vi } from 'vitest';

import {
	findStoryImageSources,
	isAllowedStoryImageSource,
	isStoryImageSourceWithin,
	MAX_STORY_EXPORT_IMAGE_BYTES,
	normalizeStoryImageAllowedSource,
	readEmbeddableStoryImages,
	type StoryImageResult,
} from '../src/story-image';

const ALLOWED = ['https://cdn.acme.com/brand', 'gs://acme-assets/marketing/', 's3://acme-products'];

describe('isAllowedStoryImageSource', () => {
	it.each([
		['https://cdn.acme.com/brand/logo.png', true],
		['gs://acme-assets/marketing/2026/hero.jpg', true],
		['s3://acme-products/sku/42.webp', true],
		['https://cdn.acme.com.evil.com/brand/logo.png', false],
		['https://cdn.acme.com/branding/logo.png', false],
		['gs://acme-assets/finance/q3.png', false],
		['gs://acme-products/sku/42.webp', false],
		['https://cdn.acme.com/brand/../secret.png', false],
		['gs://acme-assets/marketing/../finance/q3.png', false],
		['https://user:pass@cdn.acme.com/brand/logo.png', false],
		['http://cdn.acme.com/brand/logo.png', false],
		['https://cdn.acme.com/brand/..%2Fsecret.png', false],
	])('%s → %s', (src, allowed) => {
		expect(isAllowedStoryImageSource(src, ALLOWED)).toBe(allowed);
	});
});

describe('normalizeStoryImageAllowedSource', () => {
	it.each([
		[' HTTPS://CDN.Acme.com/ ', 'https://cdn.acme.com'],
		['GS://Acme-Assets/marketing/', 'gs://acme-assets/marketing/'],
		['cdn.acme.com', null],
		['https://cdn.acme.com/?token=1', null],
		['gs://', null],
	])('%s → %s', (raw, normalized) => {
		expect(normalizeStoryImageAllowedSource(raw)).toBe(normalized);
	});
});

describe('isStoryImageSourceWithin', () => {
	it.each([
		['gs://acme-assets/marketing/2026', true],
		['gs://acme-assets', false],
		['s3://acme-products/sku', true],
		['s3://other-bucket', false],
	])('%s → %s', (entry, within) => {
		expect(isStoryImageSourceWithin(entry, ALLOWED)).toBe(within);
	});
});

describe('findStoryImageSources', () => {
	it('finds image links in the code and the query rows, keeping links with spaces or brackets whole', () => {
		const code = [
			'jsx(Image, { src: "gs://acme-assets/marketing/hero.png" })',
			'jsx(Image, { src: "gs://acme-assets/marketing/Team photo (2).jpg" })',
			'jsx(Image, { src: "https://cdn.acme.com/brand/photo(1).png" })',
			'jsx(Image, { src: `gs://acme-assets/marketing/${row.key}.png` })',
		];
		const queries = {
			products: {
				columns: ['image'],
				data: [
					{ image: 's3://acme-products/sku/42.webp', id: 1n },
					{ image: 's3://acme-products/logos/Acme Corp (1).png', id: 2n },
					{ image: 'https://cdn.acme.com/brand/logo(dark).png', id: 3n },
					{ image: `https://cdn.acme.com/brand/${'a'.repeat(2048)}.png`, id: 4n },
				],
			},
		};
		expect(findStoryImageSources(code, queries)).toEqual([
			'gs://acme-assets/marketing/hero.png',
			'gs://acme-assets/marketing/Team photo (2).jpg',
			'https://cdn.acme.com/brand/photo(1).png',
			's3://acme-products/sku/42.webp',
			's3://acme-products/logos/Acme Corp (1).png',
			'https://cdn.acme.com/brand/logo(dark).png',
		]);
	});

	it.each([
		['<Table query="sites" />', []],
		['import { Image as Logo } from "nao"; <Logo src={row.logo} />', ['s3://acme-products/logo.png']],
		['<Kit.Image src={row.logo} />', ['s3://acme-products/logo.png']],
	])('reads query rows only when the code shows images: %s', (code, expected) => {
		const queries = { sites: { columns: ['logo'], data: [{ logo: 's3://acme-products/logo.png' }] } };
		expect(findStoryImageSources([code], queries)).toEqual(expected);
	});

	it('keeps only the wanted links, so unrelated ones do not use up the candidate limit', () => {
		const links = Array.from({ length: 300 }, (_, index) => `https://docs.example.com/page-${index}`);
		const code = [`${links.join(' ')} "gs://acme-assets/marketing/hero.png"`];
		const isWanted = (src: string) => isAllowedStoryImageSource(src, ALLOWED);
		expect(findStoryImageSources(code, {}, isWanted)).toEqual(['gs://acme-assets/marketing/hero.png']);
	});
});

describe('readEmbeddableStoryImages', () => {
	it('drops failures and stops reading once the export budget is spent', async () => {
		const large = `data:image/png;base64,${'a'.repeat(MAX_STORY_EXPORT_IMAGE_BYTES / 2 + 1)}`;
		const sources = Array.from({ length: 25 }, (_, index) => `gs://b/${index}.png`);
		const readBatch = vi.fn(async (batch: string[]) =>
			Object.fromEntries(
				batch.map((src): [string, StoryImageResult] => [
					src,
					src === 'gs://b/1.png' ? { error: 'Not found' } : { dataUri: large },
				]),
			),
		);
		const images = await readEmbeddableStoryImages(sources, readBatch);
		expect(Object.keys(images)).toEqual(['gs://b/0.png']);
		expect(readBatch).toHaveBeenCalledTimes(1);
	});

	it('keeps the batches that loaded when another one fails', async () => {
		const sources = Array.from({ length: 15 }, (_, index) => `gs://b/${index}.png`);
		const readBatch = vi
			.fn()
			.mockRejectedValueOnce(new Error('Bad request'))
			.mockImplementation(async (batch: string[]) =>
				Object.fromEntries(batch.map((src) => [src, { dataUri: 'data:image/png;base64,a' }])),
			);
		const images = await readEmbeddableStoryImages(sources, readBatch);
		expect(Object.keys(images)).toEqual(sources.slice(10));
	});
});
