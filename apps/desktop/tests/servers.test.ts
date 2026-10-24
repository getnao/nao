import { describe, expect, it } from 'vitest';

import {
	describeCommandError,
	describeSignInError,
	describeTooOldServer,
	displayHost,
	findServer,
	formatLastUsed,
	isInsecureServerUrl,
	type Server,
	sortServers,
} from '@/lib/servers';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function server(overrides: Partial<Server>): Server {
	return { id: 'id', name: 'Server', url: 'https://nao.example.com', lastUsedAt: null, builtIn: false, ...overrides };
}

describe('sortServers', () => {
	it('puts nao Cloud first, then the most recently used servers', () => {
		const cloud = server({ id: 'cloud', name: 'nao Cloud', builtIn: true, lastUsedAt: null });
		const old = server({ id: 'old', name: 'Old', lastUsedAt: NOW - 10_000 });
		const recent = server({ id: 'recent', name: 'Recent', lastUsedAt: NOW });
		const never = server({ id: 'never', name: 'Never', lastUsedAt: null });

		expect(sortServers([never, old, cloud, recent]).map(({ id }) => id)).toEqual([
			'cloud',
			'recent',
			'old',
			'never',
		]);
	});

	it('orders servers that were never used by name and leaves the input untouched', () => {
		const input = [server({ id: 'b', name: 'Beta' }), server({ id: 'a', name: 'Alpha' })];

		expect(sortServers(input).map(({ id }) => id)).toEqual(['a', 'b']);
		expect(input.map(({ id }) => id)).toEqual(['b', 'a']);
	});
});

describe('findServer', () => {
	it('finds a server by id and tolerates a list that is still loading', () => {
		const servers = [server({ id: 'a' }), server({ id: 'b' })];

		expect(findServer(servers, 'b')).toBe(servers[1]);
		expect(findServer(servers, 'missing')).toBeUndefined();
		expect(findServer(undefined, 'a')).toBeUndefined();
	});
});

describe('isInsecureServerUrl', () => {
	it('flags plain http URLs only', () => {
		expect(isInsecureServerUrl('http://localhost:5005')).toBe(true);
		expect(isInsecureServerUrl('  HTTP://nao.internal')).toBe(true);
		expect(isInsecureServerUrl('https://nao.example.com')).toBe(false);
		expect(isInsecureServerUrl('nao.example.com')).toBe(false);
	});
});

describe('displayHost', () => {
	it('shows the host and port of a URL', () => {
		expect(displayHost('https://nao.example.com')).toBe('nao.example.com');
		expect(displayHost('http://localhost:5005')).toBe('localhost:5005');
	});

	it('falls back to the raw value for invalid URLs', () => {
		expect(displayHost('not a url')).toBe('not a url');
	});
});

describe('formatLastUsed', () => {
	it.each([
		[null, 'Never used'],
		[NOW - 5_000, 'Used just now'],
		[NOW - 5 * 60_000, 'Used 5 min ago'],
		[NOW - 3 * 3_600_000, 'Used 3 h ago'],
		[NOW - 86_400_000, 'Used 1 day ago'],
		[NOW - 4 * 86_400_000, 'Used 4 days ago'],
		[NOW + 60_000, 'Used just now'],
	])('formats %s as "%s"', (lastUsedAt, expected) => {
		expect(formatLastUsed(lastUsedAt, NOW)).toBe(expected);
	});
});

describe('describeCommandError', () => {
	it('explains each add-server failure', () => {
		expect(describeCommandError({ kind: 'unreachable' })).toMatch(/couldn't reach/);
		expect(describeCommandError({ kind: 'not_nao' })).toMatch(/doesn't look like a nao server/);
		expect(describeCommandError({ kind: 'invalid_tls' })).toMatch(/TLS certificate/);
		expect(describeCommandError({ kind: 'invalid_url', message: 'Enter a valid URL.' })).toBe('Enter a valid URL.');
	});

	it('mentions both versions for servers that are too old', () => {
		const message = describeCommandError({ kind: 'too_old', version: '0.3.10', minimum: '0.3.29' });

		expect(message).toContain('nao 0.3.10');
		expect(message).toContain('nao 0.3.29 or later');
	});

	it('handles servers that predate the server-info endpoint', () => {
		expect(describeTooOldServer(undefined, '0.3.29')).toContain('without desktop app support');
	});

	it('falls back to a generic message for unexpected errors', () => {
		expect(describeCommandError('boom')).toBe('boom');
		expect(describeCommandError(new Error('boom'))).toMatch(/Something went wrong/);
		expect(describeCommandError({ kind: 'internal', message: '' })).toMatch(/Something went wrong/);
	});
});

describe('describeSignInError', () => {
	it('explains the errors the sign-in flow can report', () => {
		expect(describeSignInError(undefined)).toBeUndefined();
		expect(describeSignInError('access_denied')).toMatch(/denied/);
		expect(describeSignInError('timeout')).toMatch(/timed out/);
		expect(describeSignInError('desktop_auth_expired')).toMatch(/expired/);
		expect(describeSignInError('something_else')).toMatch(/didn't complete/);
	});
});
