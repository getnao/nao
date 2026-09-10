import { describe, expect, it } from 'vitest';

import {
	assertPublicHttpUrl,
	canonicalHttpUrl,
	isAllowedHostname,
	normalizeHttpUrl,
	WebRobotUrlError,
} from '../src/services/web-scraper/url-policy';

describe('web robot URL policy', () => {
	it('normalizes and canonicalizes HTTP URLs', () => {
		expect(canonicalHttpUrl('HTTPS://EXAMPLE.COM:443/products#section')).toBe('https://example.com/products');
		expect(normalizeHttpUrl('/products?page=2', 'https://example.com/catalog').toString()).toBe(
			'https://example.com/products?page=2',
		);
	});

	it('rejects non-HTTP protocols and unknown hosts', async () => {
		expect(() => normalizeHttpUrl('file:///etc/passwd')).toThrow(WebRobotUrlError);
		await expect(
			assertPublicHttpUrl('https://other.example.com', ['example.com'], { resolveDns: false }),
		).rejects.toThrow('not allowed');
	});

	it('supports exact hosts and wildcard suffixes', () => {
		expect(isAllowedHostname('www.example.com', ['www.example.com'])).toBe(true);
		expect(isAllowedHostname('cdn.example.com', ['*.example.com'])).toBe(true);
		expect(isAllowedHostname('example.com', ['*.example.com'])).toBe(true);
		expect(isAllowedHostname('badexample.com', ['*.example.com'])).toBe(false);
	});

	it('blocks localhost, link-local, and private IP literals', async () => {
		for (const url of ['http://localhost', 'http://127.0.0.1', 'http://169.254.169.254', 'http://10.0.0.4']) {
			await expect(assertPublicHttpUrl(url, [new URL(url).hostname], { resolveDns: false })).rejects.toThrow(
				WebRobotUrlError,
			);
		}
	});
});
