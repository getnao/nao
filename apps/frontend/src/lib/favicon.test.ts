import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getFaviconCandidates } from './favicon';

const stored = new Map<string, string>();

beforeEach(() => {
	stored.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => {
			stored.set(key, value);
		},
	});
	vi.resetModules();
});

describe('getFaviconCandidates', () => {
	it('uses direct same-origin favicon URLs', () => {
		expect(getFaviconCandidates('https://example.com/mcp')).toEqual([
			'https://example.com/favicon.ico',
			'https://example.com/favicon.png',
			'https://example.com/apple-touch-icon.png',
		]);
	});

	it('falls back to the parent domain of an API host', () => {
		expect(getFaviconCandidates('https://api.acme.com/v1')).toEqual([
			'https://api.acme.com/favicon.ico',
			'https://api.acme.com/favicon.png',
			'https://api.acme.com/apple-touch-icon.png',
			'https://acme.com/favicon.ico',
			'https://acme.com/favicon.png',
			'https://acme.com/apple-touch-icon.png',
		]);
	});

	it('keeps a tenant of a hosting domain to its own origin', () => {
		expect(getFaviconCandidates('https://tenant.github.io/mcp')).toEqual([
			'https://tenant.github.io/favicon.ico',
			'https://tenant.github.io/favicon.png',
			'https://tenant.github.io/apple-touch-icon.png',
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

	it('keeps a single-host endpoint to its own origin', () => {
		expect(getFaviconCandidates('http://localhost:8000/v1')).toEqual([
			'http://localhost:8000/favicon.ico',
			'http://localhost:8000/favicon.png',
			'http://localhost:8000/apple-touch-icon.png',
		]);
	});

	it('returns no candidates for missing or invalid URLs', () => {
		expect(getFaviconCandidates()).toEqual([]);
		expect(getFaviconCandidates('not a url')).toEqual([]);
	});
});

describe('resolveFaviconCandidates', () => {
	/** Each page load starts from what the browser stored, and nothing else. */
	const loadPage = async () => {
		vi.resetModules();
		return import('./favicon');
	};

	it('tries every guess for a service it knows nothing about', async () => {
		const { resolveFaviconCandidates } = await loadPage();

		expect(resolveFaviconCandidates('https://acme.com/v1')).toHaveLength(3);
	});

	it('only asks for the icon a service turned out to serve', async () => {
		const { rememberFavicon, resolveFaviconCandidates } = await loadPage();

		rememberFavicon('https://acme.com/v1', 'https://acme.com/favicon.png');

		expect(resolveFaviconCandidates('https://acme.com/v1')).toEqual(['https://acme.com/favicon.png']);
	});

	it('stops asking a service that serves no icon', async () => {
		const { rememberFavicon, resolveFaviconCandidates } = await loadPage();

		rememberFavicon('https://acme.com/v1', null);

		expect(resolveFaviconCandidates('https://acme.com/v1')).toEqual([]);
	});

	it('shares what it found between endpoints of the same origin', async () => {
		const { rememberFavicon, resolveFaviconCandidates } = await loadPage();

		rememberFavicon('https://acme.com/v1', 'https://acme.com/favicon.ico');

		expect(resolveFaviconCandidates('https://acme.com/openai/v1')).toEqual(['https://acme.com/favicon.ico']);
	});

	it('keeps what it found across page loads', async () => {
		const firstLoad = await loadPage();
		firstLoad.rememberFavicon('https://acme.com/v1', 'https://acme.com/favicon.ico');

		const secondLoad = await loadPage();

		expect(secondLoad.resolveFaviconCandidates('https://acme.com/v1')).toEqual(['https://acme.com/favicon.ico']);
	});

	it('looks again once what it found grew stale', async () => {
		const { rememberFavicon, resolveFaviconCandidates } = await loadPage();

		vi.useFakeTimers();
		rememberFavicon('https://acme.com/v1', null);
		vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
		const candidates = resolveFaviconCandidates('https://acme.com/v1');
		vi.useRealTimers();

		expect(candidates).toHaveLength(3);
	});
});
