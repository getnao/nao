import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:http';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicUrl, isPrivateAddress, isPrivateHostname, resolveSafeAddress } from '../../src/utils/safe-fetch';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ default: { lookup } }));

type Reply = { status: number; headers?: Record<string, string>; body?: string };
const pinned = vi.hoisted(() => ({
	requests: [] as { options: RequestOptions; body: unknown }[],
	replies: [] as Reply[],
}));
vi.mock('http', () => ({ default: { request: fakeRequest } }));
vi.mock('https', () => ({ default: { request: fakeRequest } }));

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
	beforeEach(() => {
		pinned.requests.length = 0;
		pinned.replies.length = 0;
	});

	it.each([
		['the metadata server', 'http://169.254.169.254/computeMetadata/v1/', 'private address'],
		['localhost', 'http://127.0.0.1:3000/api/health', 'private address'],
		['a non-http protocol', 'file:///etc/passwd', 'Only http and https'],
	])('refuses %s without sending a request', async (_target, url, message) => {
		await expect(fetchPublicUrl(url)).rejects.toThrow(message);
		expect(pinned.requests).toEqual([]);
	});

	it('connects to the address it checked even when DNS answers differently afterwards', async () => {
		lookup.mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]);
		lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
		pinned.replies.push({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });

		const response = await fetchPublicUrl('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"jsonrpc":"2.0"}',
		});

		expect(await response.json()).toEqual({ ok: true });
		const [{ options, body }] = pinned.requests;
		expect(options).toMatchObject({ host: '93.184.215.14', servername: 'mcp.example.com', method: 'POST' });
		expect(options.headers).toMatchObject({ host: 'mcp.example.com', 'content-type': 'application/json' });
		expect(body).toBe('{"jsonrpc":"2.0"}');
	});

	it('refuses a public server that redirects onto a private address', async () => {
		resolvesTo('93.184.215.14');
		pinned.replies.push({ status: 302, headers: { location: 'http://169.254.169.254/computeMetadata/v1/' } });

		await expect(fetchPublicUrl('https://mcp.example.com/mcp')).rejects.toThrow('private address');
		expect(pinned.requests).toHaveLength(1);
	});

	it('follows a public redirect and keeps credentials on their origin', async () => {
		resolvesTo('93.184.215.14');
		pinned.replies.push({ status: 307, headers: { location: 'https://other.example.com/mcp' } });
		pinned.replies.push({ status: 200, body: 'done' });

		const response = await fetchPublicUrl('https://mcp.example.com/mcp', {
			method: 'POST',
			headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
		});

		expect(await response.text()).toBe('done');
		const { options } = pinned.requests[1];
		expect(options).toMatchObject({ servername: 'other.example.com', method: 'POST' });
		expect(options.headers).not.toHaveProperty('authorization');
		expect(options.headers).toMatchObject({ 'content-type': 'application/json' });
	});
});

/** Stands in for `http.request`/`https.request`, recording the request and answering with the next reply. */
function fakeRequest(options: RequestOptions, onResponse: (response: Readable) => void) {
	const request = Object.assign(new EventEmitter(), {
		end(body?: unknown) {
			pinned.requests.push({ options, body });
			const reply = pinned.replies.shift() ?? { status: 200 };
			const response = Object.assign(Readable.from(reply.body ? [Buffer.from(reply.body)] : []), {
				statusCode: reply.status,
				headers: reply.headers ?? {},
			});
			queueMicrotask(() => onResponse(response));
		},
	});
	return request;
}
