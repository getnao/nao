import { describe, expect, it } from 'vitest';

import { withAbsoluteSocialImageUrls, withPageMetadata } from '../src/utils/spa-index-html';

const BASE_URL = 'https://app.getnao.io';

const INDEX_HTML = [
	'<title>nao — Chat with your data</title>',
	'<meta name="description" content="Default description" />',
	'<meta property="og:title" content="nao — Chat with your data" />',
	'<meta\n\tproperty="og:description"\n\tcontent="Default description"\n/>',
	'<meta property="og:image:alt" content="nao — Chat with your data" />',
	'<meta name="twitter:title" content="nao — Chat with your data" />',
	'<meta name="twitter:description" content="Default description" />',
	'<meta property="og:site_name" content="nao" />',
].join('\n');

describe('withPageMetadata', () => {
	it('replaces the document title and every title/description meta tag', () => {
		const result = withPageMetadata(INDEX_HTML, { title: 'Q3 revenue', description: 'A story shared on nao.' });

		expect(result).toBe(
			[
				'<title>Q3 revenue</title>',
				'<meta name="description" content="A story shared on nao." />',
				'<meta property="og:title" content="Q3 revenue" />',
				'<meta\n\tproperty="og:description"\n\tcontent="A story shared on nao."\n/>',
				'<meta property="og:image:alt" content="nao — Chat with your data" />',
				'<meta name="twitter:title" content="Q3 revenue" />',
				'<meta name="twitter:description" content="A story shared on nao." />',
				'<meta property="og:site_name" content="nao" />',
			].join('\n'),
		);
	});

	it('escapes html so titles cannot break out of attributes or inject markup', () => {
		const result = withPageMetadata(INDEX_HTML, {
			title: '"><script>alert(1)</script> & co',
			description: "it's <b>bold</b>",
		});

		expect(result).toContain('<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</title>');
		expect(result).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"');
		expect(result).toContain('content="it&#39;s &lt;b&gt;bold&lt;/b&gt;"');
		expect(result).not.toContain('<script>');
	});

	it('treats replacement patterns in titles literally', () => {
		const result = withPageMetadata(INDEX_HTML, { title: 'Revenue $& $1 $$', description: 'x' });

		expect(result).toContain('<title>Revenue $& $1 $$</title>'.replace('&', '&amp;'));
	});
});

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
