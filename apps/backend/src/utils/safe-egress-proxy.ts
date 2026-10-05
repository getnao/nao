import http from 'http';
import type { AddressInfo } from 'net';
import net from 'net';

import { resolveSafeAddress } from './safe-fetch';

const WEB_PORTS: ReadonlySet<number> = new Set([80, 443]);

export interface SafeEgressProxy {
	url: string;
	close: () => Promise<void>;
}

export interface SafeEgressProxyOptions {
	resolveAddress?: (hostname: string) => Promise<string>;
	allowedPorts?: ReadonlySet<number>;
}

type ResolveDestination = (hostname: string, port: number) => Promise<{ address: string; port: number }>;

/**
 * Starts a loopback HTTP proxy that resolves each destination once, refuses private addresses,
 * and connects to the address it checked. A headless browser sent through it cannot be
 * DNS-rebound onto an internal host between the check and the connection.
 */
export async function startSafeEgressProxy({
	resolveAddress = resolveSafeAddress,
	allowedPorts = WEB_PORTS,
}: SafeEgressProxyOptions = {}): Promise<SafeEgressProxy> {
	const tunnelSockets = new Set<net.Socket>();
	const resolveDestination: ResolveDestination = async (hostname, port) => {
		if (!allowedPorts.has(port)) {
			throw new Error(`Port ${port} is not allowed.`);
		}
		return { address: await resolveAddress(hostname), port };
	};

	const server = http.createServer((request, response) => forwardPlainRequest(request, response, resolveDestination));
	server.on('connect', (request: http.IncomingMessage, client: net.Socket, head: Buffer) =>
		tunnelConnect(request, client, head, resolveDestination, tunnelSockets),
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise((resolve) => {
				tunnelSockets.forEach((socket) => socket.destroy());
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

/** CONNECT sockets leave the HTTP server's bookkeeping, so they are tracked to be destroyed on close. */
async function tunnelConnect(
	request: http.IncomingMessage,
	client: net.Socket,
	head: Buffer,
	resolveDestination: ResolveDestination,
	tunnelSockets: Set<net.Socket>,
): Promise<void> {
	trackSocket(client, tunnelSockets);
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
		trackSocket(upstream, tunnelSockets);
		upstream.on('error', () => client.destroy());
		client.on('close', () => upstream.destroy());
	} catch {
		client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
	}
}

async function forwardPlainRequest(
	request: http.IncomingMessage,
	response: http.ServerResponse,
	resolveDestination: ResolveDestination,
): Promise<void> {
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
		response.on('close', () => upstream.destroy());
		request.pipe(upstream);
	} catch {
		response.writeHead(403).end();
	}
}

function trackSocket(socket: net.Socket, sockets: Set<net.Socket>): void {
	sockets.add(socket);
	socket.once('close', () => sockets.delete(socket));
}
