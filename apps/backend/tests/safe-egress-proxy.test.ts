import http from 'http';
import type { AddressInfo } from 'net';
import net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SafeEgressProxy, startSafeEgressProxy } from '../src/utils/safe-egress-proxy';

vi.mock('dns/promises', () => ({
	default: { lookup: async () => [{ address: '127.0.0.1', family: 4 }] },
}));

const servers: net.Server[] = [];
let proxy: SafeEgressProxy;

afterEach(async () => {
	await proxy.close();
	await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
	servers.length = 0;
});

describe('startSafeEgressProxy refusals', () => {
	it('refuses to tunnel to a hostname that resolves to a private address', async () => {
		proxy = await startSafeEgressProxy();
		expect(await connectStatusLine('rebinding.example.com:443')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses to tunnel to a literal private address', async () => {
		proxy = await startSafeEgressProxy();
		expect(await connectStatusLine('[::ffff:7f00:1]:443')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses ports other than 80 and 443', async () => {
		proxy = await startSafeEgressProxy();
		expect(await connectStatusLine('93.184.215.14:22')).toBe('HTTP/1.1 403 Forbidden');
	});

	it('refuses plain HTTP requests to a private destination', async () => {
		proxy = await startSafeEgressProxy();
		expect(await plainRequest('http://rebinding.example.com/')).toMatchObject({ status: 403 });
	});
});

describe('startSafeEgressProxy forwarding', () => {
	it('tunnels CONNECT traffic, including bytes sent with the request, to the resolved address', async () => {
		const upstreamPort = await listen(net.createServer((socket) => socket.pipe(socket)));
		proxy = await startSafeEgressProxy(allowingPort(upstreamPort));

		const tunnel = await openTunnel(`public.example.com:${upstreamPort}`, 'hello');

		expect(tunnel.statusLine).toBe('HTTP/1.1 200 Connection Established');
		expect(await tunnel.nextData()).toBe('hello');
		tunnel.socket.write('again');
		expect(await tunnel.nextData()).toBe('again');
		tunnel.socket.destroy();
	});

	it('forwards plain HTTP requests with the original Host header', async () => {
		const upstreamPort = await listen(http.createServer((request, response) => response.end(request.headers.host)));
		proxy = await startSafeEgressProxy(allowingPort(upstreamPort));

		const result = await plainRequest(`http://public.example.com:${upstreamPort}/page`);

		expect(result).toEqual({ status: 200, body: `public.example.com:${upstreamPort}` });
	});

	it('closes while a tunnel is still open', async () => {
		const upstreamPort = await listen(net.createServer((socket) => socket.pipe(socket)));
		proxy = await startSafeEgressProxy(allowingPort(upstreamPort));
		const tunnel = await openTunnel(`public.example.com:${upstreamPort}`, '');

		const tunnelClosed = new Promise((resolve) => tunnel.socket.once('close', () => resolve(true)));

		expect(await withinTwoSeconds(proxy.close().then(() => true))).toBe(true);
		expect(await withinTwoSeconds(tunnelClosed)).toBe(true);
	});
});

function withinTwoSeconds<T>(promise: Promise<T>): Promise<T | false> {
	return Promise.race([promise, new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000))]);
}

function allowingPort(port: number) {
	return { resolveAddress: async () => '127.0.0.1', allowedPorts: new Set([port]) };
}

async function listen(server: net.Server): Promise<number> {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return (server.address() as AddressInfo).port;
}

async function openTunnel(authority: string, firstBytes: string) {
	const { port } = new URL(proxy.url);
	const socket = net.connect(Number(port), '127.0.0.1');
	const chunks: string[] = [];
	const waiters: ((data: string) => void)[] = [];
	socket.on('data', (data) => {
		const waiter = waiters.shift();
		if (waiter) {
			waiter(data.toString());
		} else {
			chunks.push(data.toString());
		}
	});
	const nextData = () =>
		chunks.length > 0 ? Promise.resolve(chunks.shift()!) : new Promise<string>((resolve) => waiters.push(resolve));
	await new Promise((resolve) => socket.once('connect', resolve));
	socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${firstBytes}`);
	const [statusLine, rest] = (await nextData()).split('\r\n\r\n');
	if (rest) {
		chunks.unshift(rest);
	}
	return { socket, statusLine: statusLine.split('\r\n')[0], nextData };
}

async function connectStatusLine(authority: string): Promise<string> {
	const tunnel = await openTunnel(authority, '');
	tunnel.socket.destroy();
	return tunnel.statusLine;
}

function plainRequest(url: string): Promise<{ status: number | undefined; body: string }> {
	const { port } = new URL(proxy.url);
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: Number(port), path: url, headers: { host: new URL(url).host } }, (res) => {
			let body = '';
			res.on('data', (chunk) => (body += chunk));
			res.on('end', () => resolve({ status: res.statusCode, body }));
		}).once('error', reject);
	});
}
