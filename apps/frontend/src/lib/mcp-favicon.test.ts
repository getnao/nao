import { describe, expect, it } from 'vitest';

import { getFaviconCandidates } from './mcp-favicon';

describe('getFaviconCandidates', () => {
	it('uses direct same-origin favicon URLs', () => {
		expect(getFaviconCandidates('https://internal.example.co.uk/mcp')).toEqual([
			'https://internal.example.co.uk/favicon.ico',
			'https://internal.example.co.uk/favicon.png',
			'https://internal.example.co.uk/apple-touch-icon.png',
		]);
	});

	it('preserves the server origin and never calls a third-party favicon API', () => {
		const candidates = getFaviconCandidates('https://tenant.localhost:3000/path');

		expect(candidates).toEqual([
			'https://tenant.localhost:3000/favicon.ico',
			'https://tenant.localhost:3000/favicon.png',
			'https://tenant.localhost:3000/apple-touch-icon.png',
		]);
		expect(candidates.join('\n')).not.toContain('google.com');
	});

	it('returns no candidates for missing or invalid URLs', () => {
		expect(getFaviconCandidates()).toEqual([]);
		expect(getFaviconCandidates('not a url')).toEqual([]);
	});
});
