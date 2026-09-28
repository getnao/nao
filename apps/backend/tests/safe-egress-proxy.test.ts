import http from 'http';
import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type SafeEgressProxy, startSafeEgressProxy } from '../src/utils/safe-egress-proxy';

vi.mock('dns/promises', () => ({
	default: { lookup: async () => [{ address: '127.0.0.1', family: 4 }] },
}));

let proxy: SafeEgressProxy;

beforeEach(async () => {
	proxy = await startSafeEgressProxy();
});

afterEach(async () => {
	await proxy.close();
});

describe('startSafeEgressProxy', () => {
	it('refuses to tunnel to a hostname that resolves to a private address', async () => {
		expect(await connectStatusLine('rebinding.example.com:443')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses to tunnel to a literal private address', async () => {
		expect(await connectStatusLine('[::ffff:7f00:1]:443')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses ports other than 80 and 443', async () => {
		expect(await connectStatusLine('93.184.215.14:22')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses plain HTTP requests to a private destination', async () => {
		expect(await plainRequestStatus('http://rebinding.example.com/')).toBe(403);
	});
});

function connectStatusLine(authority: string): Promise<string> {
	const { port } = new URL(proxy.url);
	return new Promise((resolve, reject) => {
		const socket = net.connect(Number(port), '127.0.0.1', () => {
			socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
		});
		socket.once('data', (data) => {
			resolve(data.toString().split('\r\n')[0]);
			socket.destroy();
		});
		socket.once('error', reject);
	});
}

function plainRequestStatus(url: string): Promise<number | undefined> {
	const { port } = new URL(proxy.url);
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: Number(port), path: url, headers: { host: new URL(url).host } }, (res) => {
			res.resume();
			resolve(res.statusCode);
		}).once('error', reject);
	});
}
