import http from 'http';
import type { AddressInfo } from 'net';
import net from 'net';

import { resolveSafeAddress } from './safe-fetch';

const ALLOWED_PORTS = new Set([80, 443]);

export interface SafeEgressProxy {
	url: string;
	close: () => Promise<void>;
}

/**
 * Starts a loopback HTTP proxy that resolves each destination once, refuses private addresses,
 * and connects to the address it checked. A headless browser sent through it cannot be
 * DNS-rebound onto an internal host between the check and the connection.
 */
export async function startSafeEgressProxy(): Promise<SafeEgressProxy> {
	const server = http.createServer(forwardPlainRequest);
	server.on('connect', tunnelConnect);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

async function tunnelConnect(request: http.IncomingMessage, client: net.Socket, head: Buffer): Promise<void> {
	client.on('error', () => client.destroy());
	try {
		const { hostname, port } = new URL(`http://${request.url}`);
		const destination = await resolveDestination(hostname, Number(port || 443));
		const upstream = net.connect(destination.port, destination.address, () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.on('error', () => client.destroy());
	} catch {
		client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
	}
}

async function forwardPlainRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
	try {
		const target = new URL(request.url ?? '');
		const destination = await resolveDestination(target.hostname, Number(target.port || 80));
		const upstream = http.request(
			{
				host: destination.address,
				port: destination.port,
				method: request.method,
				path: `${target.pathname}${target.search}`,
				headers: { ...request.headers, host: target.host },
				setHost: false,
			},
			(upstreamResponse) => {
				response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
				upstreamResponse.pipe(response);
			},
		);
		upstream.on('error', () => response.destroy());
		request.pipe(upstream);
	} catch {
		response.writeHead(403).end();
	}
}

async function resolveDestination(hostname: string, port: number): Promise<{ address: string; port: number }> {
	if (!ALLOWED_PORTS.has(port)) {
		throw new Error(`Port ${port} is not allowed.`);
	}
	return { address: await resolveSafeAddress(hostname), port };
}
