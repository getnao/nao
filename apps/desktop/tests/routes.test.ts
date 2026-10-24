import { describe, expect, it } from 'vitest';

import { isHttpUrl, parseRoute, type Route, routeHash } from '@/lib/routes';

describe('parseRoute', () => {
	it('shows the server picker by default', () => {
		expect(parseRoute('')).toEqual({ name: 'servers' });
		expect(parseRoute('#/')).toEqual({ name: 'servers' });
		expect(parseRoute('#/unknown?server=a')).toEqual({ name: 'servers' });
	});

	it('falls back to the picker when a server screen has no server', () => {
		expect(parseRoute('#/connecting')).toEqual({ name: 'servers' });
		expect(parseRoute('#/sign-in?error=timeout')).toEqual({ name: 'servers' });
	});

	it('parses the add-server screen', () => {
		expect(parseRoute('#/add-server')).toEqual({ name: 'add-server' });
	});

	it('parses server screens and their parameters', () => {
		expect(parseRoute('#/connecting?server=abc')).toEqual({ name: 'connecting', serverId: 'abc' });
		expect(parseRoute('#/sign-in?server=abc&error=access_denied')).toEqual({
			name: 'sign-in',
			serverId: 'abc',
			error: 'access_denied',
		});
		expect(parseRoute('#/too-old?server=abc&version=0.3.1&minimum=0.3.29')).toEqual({
			name: 'too-old',
			serverId: 'abc',
			version: '0.3.1',
			minimum: '0.3.29',
		});
	});

	it('defaults unknown unreachable reasons to "unreachable"', () => {
		expect(parseRoute('#/unreachable?server=abc&reason=invalid_tls')).toEqual({
			name: 'unreachable',
			serverId: 'abc',
			reason: 'invalid_tls',
		});
		expect(parseRoute('#/unreachable?server=abc&reason=bogus')).toEqual({
			name: 'unreachable',
			serverId: 'abc',
			reason: 'unreachable',
		});
	});

	it('only offers http(s) sign-in links to copy', () => {
		const signInUrl = 'https://nao.example.com/cli-login?port=1234&state=s&client=desktop';
		expect(parseRoute(`#/signing-in?server=abc&signInUrl=${encodeURIComponent(signInUrl)}`)).toEqual({
			name: 'signing-in',
			serverId: 'abc',
			signInUrl,
		});
		expect(parseRoute('#/signing-in?server=abc&signInUrl=javascript%3Aalert(1)')).toEqual({
			name: 'sign-in',
			serverId: 'abc',
		});
	});
});

describe('routeHash', () => {
	const routes: Route[] = [
		{ name: 'servers' },
		{ name: 'add-server' },
		{ name: 'connecting', serverId: 'abc' },
		{ name: 'signing-in', serverId: 'abc', signInUrl: 'https://nao.example.com/cli-login?port=1&state=x' },
		{ name: 'sign-in', serverId: 'abc', error: 'timeout' },
		{ name: 'unreachable', serverId: 'abc', reason: 'not_nao' },
		{ name: 'too-old', serverId: 'abc', version: '0.2.0', minimum: '0.3.29' },
	];

	it.each(routes)('round-trips the $name route', (route) => {
		expect(parseRoute(routeHash(route))).toEqual(route);
	});

	it('omits optional parameters that are not set', () => {
		expect(routeHash({ name: 'sign-in', serverId: 'abc' })).toBe('#/sign-in?server=abc');
	});
});

describe('isHttpUrl', () => {
	it('accepts only http and https URLs', () => {
		expect(isHttpUrl('https://nao.example.com')).toBe(true);
		expect(isHttpUrl('http://localhost:5005')).toBe(true);
		expect(isHttpUrl('file:///etc/passwd')).toBe(false);
		expect(isHttpUrl('nao.example.com')).toBe(false);
	});
});
