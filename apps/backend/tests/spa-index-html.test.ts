import { describe, expect, it } from 'vitest';

import { withAbsoluteSocialImageUrls } from '../src/utils/spa-index-html';

const BASE_URL = 'https://app.getnao.io';

describe('withAbsoluteSocialImageUrls', () => {
	it('resolves relative og:image and twitter:image paths against the base url', () => {
		const html = [
			'<meta property="og:image" content="/og-image.jpg" />',
			'<meta name="twitter:image" content="/og-image.jpg" />',
		].join('\n');

		expect(withAbsoluteSocialImageUrls(html, BASE_URL)).toBe(
			[
				'<meta property="og:image" content="https://app.getnao.io/og-image.jpg" />',
				'<meta name="twitter:image" content="https://app.getnao.io/og-image.jpg" />',
			].join('\n'),
		);
	});

	it('handles multi-line meta tags with attributes in any order', () => {
		const html = '<meta\n\tcontent="/og-image.jpg"\n\tproperty="og:image"\n/>';

		expect(withAbsoluteSocialImageUrls(html, BASE_URL)).toBe(
			'<meta\n\tcontent="https://app.getnao.io/og-image.jpg"\n\tproperty="og:image"\n/>',
		);
	});

	it('leaves other meta tags and relative links untouched', () => {
		const html = [
			'<meta property="og:title" content="nao — Chat with your data" />',
			'<meta property="og:image:width" content="1200" />',
			'<link rel="icon" href="/favicon.ico" />',
			'<meta property="og:url" content="/" />',
		].join('\n');

		expect(withAbsoluteSocialImageUrls(html, BASE_URL)).toBe(html);
	});

	it('does not rewrite images that are already absolute or protocol-relative', () => {
		const html = [
			'<meta property="og:image" content="https://cdn.example.com/preview.png" />',
			'<meta name="twitter:image" content="//cdn.example.com/preview.png" />',
		].join('\n');

		expect(withAbsoluteSocialImageUrls(html, BASE_URL)).toBe(html);
	});
});
