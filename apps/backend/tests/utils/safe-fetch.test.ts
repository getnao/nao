import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicUrl, isPrivateAddress, isPrivateHostname, resolveSafeAddress } from '../../src/utils/safe-fetch';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ default: { lookup } }));

function resolvesTo(...addresses: string[]): void {
	lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

describe('isPrivateHostname', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'[::1]',
		'[::]',
		'[::ffff:127.0.0.1]',
		'[::ffff:7f00:1]',
		'[::ffff:a9fe:a9fe]',
		'[0:0:0:0:0:ffff:7f00:1]',
		'[::7f00:1]',
		'[64:ff9b::7f00:1]',
		'[fc00::1]',
		'[fe80::1]',
		'[ff02::1]',
		'localhost',
		'metadata.internal',
	])('rejects %s', (host) => {
		expect(isPrivateHostname(host)).toBe(true);
	});

	it.each(['8.8.8.8', '[2606:4700::1111]', '[::ffff:808:808]', '[64:ff9b::808:808]', 'example.com'])(
		'allows %s',
		(host) => {
			expect(isPrivateHostname(host)).toBe(false);
		},
	);

	it('rejects hostnames the URL parser normalizes to hex IPv4-mapped form', () => {
		const { hostname } = new URL('http://[::ffff:127.0.0.1]/');
		expect(isPrivateHostname(hostname)).toBe(true);
	});
});

describe('isPrivateAddress range boundaries', () => {
	it.each(['172.16.0.0', '172.31.255.255', '100.64.0.0', '100.127.255.255', '198.18.0.0', '198.19.255.255'])(
		'rejects %s',
		(address) => {
			expect(isPrivateAddress(address)).toBe(true);
		},
	);

	it.each(['172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '198.17.255.255', '198.20.0.0'])(
		'allows %s',
		(address) => {
			expect(isPrivateAddress(address)).toBe(false);
		},
	);
});

describe('resolveSafeAddress', () => {
	it('returns the address it checked', async () => {
		resolvesTo('93.184.215.14');

		expect(await resolveSafeAddress('example.com')).toBe('93.184.215.14');
	});

	it('rejects a hostname that resolves to a private address', async () => {
		resolvesTo('10.0.0.5');

		await expect(resolveSafeAddress('rebinding.example.com')).rejects.toThrow('private IP address');
	});

	it('rejects a hostname when any of its answers is private', async () => {
		resolvesTo('93.184.215.14', '::ffff:7f00:1');

		await expect(resolveSafeAddress('mixed.example.com')).rejects.toThrow('private IP address');
	});

	it('rejects a hostname that does not resolve', async () => {
		lookup.mockRejectedValue(new Error('ENOTFOUND'));

		await expect(resolveSafeAddress('missing.example.com')).rejects.toThrow('Could not resolve');
	});

	it('returns a public literal address without resolving it', async () => {
		lookup.mockClear();

		expect(await resolveSafeAddress('[2606:4700::1111]')).toBe('2606:4700::1111');
		expect(lookup).not.toHaveBeenCalled();
	});
});

describe('fetchPublicUrl', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		['the metadata server', 'http://169.254.169.254/computeMetadata/v1/', 'private address'],
		['localhost', 'http://127.0.0.1:3000/api/health', 'private address'],
		['a non-http protocol', 'file:///etc/passwd', 'Only http and https'],
	])('refuses %s without sending a request', async (_target, url, message) => {
		const fetchMock = stubFetch(new Response('ok'));

		await expect(fetchPublicUrl(url)).rejects.toThrow(message);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a public server that redirects onto a private address', async () => {
		resolvesTo('93.184.215.14');
		const fetchMock = stubFetch(redirectTo('http://169.254.169.254/computeMetadata/v1/'));

		await expect(fetchPublicUrl('https://mcp.example.com/mcp')).rejects.toThrow('private address');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('follows a public redirect and keeps credentials on their origin', async () => {
		resolvesTo('93.184.215.14');
		const fetchMock = stubFetch(redirectTo('https://other.example.com/mcp', 307), new Response('done'));

		const response = await fetchPublicUrl('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
		});

		expect(await response.text()).toBe('done');
		const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
		expect(url.toString()).toBe('https://other.example.com/mcp');
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('authorization')).toBeNull();
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
	});
});

function stubFetch(...responses: Response[]) {
	const fetchMock = vi.fn();
	for (const response of responses) {
		fetchMock.mockResolvedValueOnce(response);
	}
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function redirectTo(location: string, status = 302): Response {
	return new Response(null, { status, headers: { location } });
}
