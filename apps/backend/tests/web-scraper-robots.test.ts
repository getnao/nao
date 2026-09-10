import { describe, expect, it } from 'vitest';

import { parseRobotsTxt, RobotsTxtPolicy } from '../src/services/web-scraper/robots-txt';

describe('robots.txt policy', () => {
	it('parses agent groups and longest-path decisions', () => {
		const groups = parseRobotsTxt(`
			User-agent: *
			Disallow: /private
			Allow: /private/public

			User-agent: nao
			Disallow: /blocked
		`);
		expect(groups).toHaveLength(2);
	});

	it('rejects disallowed URLs and allows matching exceptions', async () => {
		const policy = new RobotsTxtPolicy(
			async () => `
			User-agent: *
			Disallow: /private
			Allow: /private/public
		`,
		);

		await expect(policy.assertAllowed('https://example.com/private/item')).rejects.toThrow('robots.txt disallows');
		await expect(policy.assertAllowed('https://example.com/private/public/item')).resolves.toBeUndefined();
	});

	it('prefers a matching user agent over the wildcard group', async () => {
		const policy = new RobotsTxtPolicy(
			async () => `
			User-agent: *
			Disallow: /all

			User-agent: nao-web-robot
			Disallow: /robot-only
		`,
		);

		await expect(policy.assertAllowed('https://example.com/all')).resolves.toBeUndefined();
		await expect(policy.assertAllowed('https://example.com/robot-only')).rejects.toThrow('robots.txt disallows');
	});
});
