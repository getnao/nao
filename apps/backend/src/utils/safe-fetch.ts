import { type GeoJsonValidationResult, validateGeoJson } from '@nao/shared';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { pipeline, Readable } from 'stream';
import zlib from 'zlib';

import { UnsafeUrlError } from './security-errors';
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const PRIVATE_IPV4_RANGES = [
	{ start: ip4ToInt('0.0.0.0'), end: ip4ToInt('0.255.255.255') },
	{ start: ip4ToInt('10.0.0.0'), end: ip4ToInt('10.255.255.255') },
	{ start: ip4ToInt('100.64.0.0'), end: ip4ToInt('100.127.255.255') },
	{ start: ip4ToInt('127.0.0.0'), end: ip4ToInt('127.255.255.255') },
	{ start: ip4ToInt('169.254.0.0'), end: ip4ToInt('169.254.255.255') },
	{ start: ip4ToInt('172.16.0.0'), end: ip4ToInt('172.31.255.255') },
	{ start: ip4ToInt('192.0.0.0'), end: ip4ToInt('192.0.0.255') },
	{ start: ip4ToInt('192.0.2.0'), end: ip4ToInt('192.0.2.255') },
	{ start: ip4ToInt('192.88.99.0'), end: ip4ToInt('192.88.99.255') },
	{ start: ip4ToInt('192.168.0.0'), end: ip4ToInt('192.168.255.255') },
	{ start: ip4ToInt('198.18.0.0'), end: ip4ToInt('198.19.255.255') },
	{ start: ip4ToInt('198.51.100.0'), end: ip4ToInt('198.51.100.255') },
	{ start: ip4ToInt('203.0.113.0'), end: ip4ToInt('203.0.113.255') },
	{ start: ip4ToInt('224.0.0.0'), end: ip4ToInt('255.255.255.255') },
];

const DEFAULT_HEADERS = { accept: '*/*', 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'nao' };

const PRIVATE_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local', '.arpa'];

export interface SafeFetchResult {
	text: string;
	url: string;
}

export interface SafeFetchBytesResult {
	bytes: Buffer;
	contentType: string | undefined;
	url: string;
}

interface PinnedRequest {
	method?: string;
	headers?: Record<string, string>;
	body?: string | Buffer;
}

interface PinnedResponse {
	status: number;
	location: string | undefined;
	contentType: string | undefined;
	headers: http.IncomingHttpHeaders;
	body: Readable;
}

export interface SafeFetchOptions {
	allowHttp?: boolean;
	maxBytes?: number;
	headers?: Record<string, string>;
}

function ip4ToInt(ip: string): number {
	return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
	if (!net.isIPv4(ip)) {
		return false;
	}
	const value = ip4ToInt(ip);
	return PRIVATE_IPV4_RANGES.some((range) => value >= range.start && value <= range.end);
}

function isPrivateIPv6(ip: string): boolean {
	if (!net.isIPv6(ip)) {
		return false;
	}
	const hextets = expandIPv6(ip.toLowerCase());
	const embeddedIPv4 = embeddedIPv4Of(hextets);
	if (embeddedIPv4 !== null) {
		return isPrivateIPv4(embeddedIPv4);
	}
	const [first] = hextets;
	const isUniqueLocal = (first & 0xfe00) === 0xfc00;
	const isLinkLocal = (first & 0xffc0) === 0xfe80;
	const isMulticast = (first & 0xff00) === 0xff00;
	return isUniqueLocal || isLinkLocal || isMulticast;
}

/** Returns the IPv4 address carried by IPv4-mapped, IPv4-compatible (incl. `::` and `::1`) and NAT64 forms. */
function embeddedIPv4Of(hextets: number[]): string | null {
	const prefix = hextets.slice(0, 6);
	const isMapped = prefix.slice(0, 5).every((hextet) => hextet === 0) && prefix[5] === 0xffff;
	const isCompatible = prefix.every((hextet) => hextet === 0);
	const isNat64 = prefix[0] === 0x64 && prefix[1] === 0xff9b && prefix.slice(2).every((hextet) => hextet === 0);
	if (!isMapped && !isCompatible && !isNat64) {
		return null;
	}
	const [high, low] = [hextets[6], hextets[7]];
	return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function expandIPv6(ip: string): number[] {
	const withoutZone = ip.split('%')[0];
	const dottedSuffix = withoutZone.match(/(\d+\.\d+\.\d+\.\d+)$/);
	const hexOnly = dottedSuffix
		? withoutZone.slice(0, -dottedSuffix[1].length) + ipv4ToHextets(dottedSuffix[1])
		: withoutZone;
	const [head, tail] = hexOnly.split('::');
	const headParts = head ? head.split(':') : [];
	const tailParts = tail ? tail.split(':') : [];
	const missing = hexOnly.includes('::') ? 8 - headParts.length - tailParts.length : 0;
	return [...headParts, ...Array<string>(missing).fill('0'), ...tailParts].map((part) => parseInt(part, 16));
}

function ipv4ToHextets(ip: string): string {
	const value = ip4ToInt(ip);
	return `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
}

export function isPrivateAddress(address: string): boolean {
	return isPrivateIPv4(address) || isPrivateIPv6(address);
}

export function isPrivateHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return true;
	}
	return net.isIP(host) !== 0 && isPrivateAddress(host);
}

/** Refuses hosts that are private by name, by literal address, or by what they resolve to. */
export async function assertSafeHost(hostname: string): Promise<void> {
	await resolveSafeAddress(hostname);
}

/**
 * Resolves a host once and returns an address that passed the private-range checks.
 * Connecting to that exact address, rather than to the hostname, closes the DNS-rebinding window.
 */
export async function resolveSafeAddress(hostname: string): Promise<string> {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (isPrivateHostname(host)) {
		throw new UnsafeUrlError(`Access to private address "${hostname}" is not allowed.`, hostname);
	}
	if (net.isIP(host)) {
		return host;
	}

	let addresses: string[];
	try {
		const results = await dns.lookup(host, { all: true });
		addresses = results.map((r) => r.address);
	} catch {
		throw new Error(`Could not resolve hostname "${hostname}".`);
	}
	if (addresses.length === 0) {
		throw new Error(`Could not resolve hostname "${hostname}".`);
	}
	if (addresses.some(isPrivateAddress)) {
		throw new UnsafeUrlError(
			`Hostname "${hostname}" resolves to a private IP address, which is not allowed.`,
			hostname,
		);
	}
	return addresses[0];
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<string> {
	return (await safeFetchWithUrl(url, options)).text;
}

export async function safeFetchWithUrl(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
	const { bytes, url: finalUrl } = await safeFetchBytes(url, options);
	return { text: new TextDecoder().decode(bytes), url: finalUrl };
}

export async function safeFetchBytes(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchBytesResult> {
	const { response, url: finalUrl } = await fetchFollowingRedirects(url, options, 0);
	return {
		bytes: await readBodyBytes(response.body, options.maxBytes ?? MAX_BYTES),
		contentType: response.contentType,
		url: finalUrl,
	};
}

/**
 * A `fetch` that only reaches public addresses. Each hop connects to the address it checked, so DNS
 * cannot swap in a private one, and redirects are followed here so none can bounce onto an internal host.
 */
export async function fetchPublicUrl(input: string | URL, init: RequestInit = {}): Promise<Response> {
	let url = new URL(input);
	let hopInit = await withEncodedBody(init);
	for (let redirectCount = 0; ; redirectCount++) {
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			throw new Error('Only http and https URLs are allowed.');
		}
		const address = await resolveSafeAddress(url.hostname);
		const response = await requestPinnedAddress(
			url,
			address,
			pinnedRequestOf(hopInit),
			hopInit.signal ?? undefined,
		);
		if (response.status < 300 || response.status >= 400 || !response.location) {
			return toWebResponse(response, hopInit.method);
		}
		response.body.destroy();
		if (redirectCount >= MAX_REDIRECTS) {
			throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
		}
		const nextUrl = new URL(response.location, url);
		hopInit = redirectedInit(hopInit, response.status, nextUrl.origin !== url.origin);
		url = nextUrl;
	}
}

/** Mirrors what `fetch` does on a redirect: 301-303 turn into a GET, and credentials stay on their origin. */
function redirectedInit(init: RequestInit, status: number, crossesOrigin: boolean): RequestInit {
	const headers = new Headers(init.headers);
	if (crossesOrigin) {
		headers.delete('authorization');
		headers.delete('cookie');
	}
	const keepsMethod = status === 307 || status === 308;
	return keepsMethod ? { ...init, headers } : { ...init, headers, method: 'GET', body: undefined };
}

/** Multipart and blob bodies are encoded once up front, so every hop sends the same bytes. */
async function withEncodedBody(init: RequestInit): Promise<RequestInit> {
	if (!(init.body instanceof FormData) && !(init.body instanceof Blob)) {
		return init;
	}
	const encoded = new Response(init.body);
	const headers = new Headers(init.headers);
	const contentType = encoded.headers.get('content-type');
	if (contentType && !headers.has('content-type')) {
		headers.set('content-type', contentType);
	}
	return { ...init, headers, body: Buffer.from(await encoded.arrayBuffer()) };
}

function pinnedRequestOf(init: RequestInit): PinnedRequest {
	const headers = new Headers(init.headers);
	const { body } = init;
	if (body instanceof URLSearchParams && !headers.has('content-type')) {
		headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
	}
	return { method: init.method, headers: Object.fromEntries(headers), body: requestBodyOf(body) };
}

function requestBodyOf(body: RequestInit['body']): string | Buffer | undefined {
	if (body === undefined || body === null || typeof body === 'string') {
		return body ?? undefined;
	}
	if (body instanceof URLSearchParams) {
		return body.toString();
	}
	if (body instanceof ArrayBuffer) {
		return Buffer.from(body);
	}
	if (ArrayBuffer.isView(body)) {
		return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	}
	throw new Error('Unsupported request body type.');
}

function toWebResponse(response: PinnedResponse, method: string | undefined): Response {
	const headers = new Headers();
	const isDecoded = response.headers['content-encoding'] !== undefined;
	for (const [name, value] of Object.entries(response.headers)) {
		if (value === undefined || (isDecoded && (name === 'content-encoding' || name === 'content-length'))) {
			continue;
		}
		for (const item of [value].flat()) {
			headers.append(name, item);
		}
	}
	const hasBody = method?.toUpperCase() !== 'HEAD' && ![204, 205, 304].includes(response.status);
	if (!hasBody) {
		response.body.destroy();
	}
	const body = hasBody ? (Readable.toWeb(response.body) as unknown as ReadableStream<Uint8Array>) : null;
	return new Response(body, { status: response.status, headers });
}

async function fetchFollowingRedirects(
	url: string,
	options: SafeFetchOptions,
	redirectCount: number,
): Promise<{ response: PinnedResponse; url: string }> {
	if (redirectCount > MAX_REDIRECTS) {
		throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: "${url}".`);
	}

	const allowedProtocols = options.allowHttp ? ['https:', 'http:'] : ['https:'];
	if (!allowedProtocols.includes(parsed.protocol)) {
		throw new Error(options.allowHttp ? 'Only http and https URLs are allowed.' : 'Only HTTPS URLs are allowed.');
	}

	const address = await resolveSafeAddress(parsed.hostname);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	let response: PinnedResponse;
	try {
		response = await requestPinnedAddress(
			parsed,
			address,
			{ headers: { ...DEFAULT_HEADERS, ...options.headers } },
			controller.signal,
		);
	} catch (err) {
		throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		clearTimeout(timer);
	}

	if (response.status >= 300 && response.status < 400) {
		response.body.destroy();
		if (!response.location) {
			throw new Error('Redirect without location header.');
		}
		return fetchFollowingRedirects(new URL(response.location, parsed).toString(), options, redirectCount + 1);
	}

	if (response.status < 200 || response.status >= 300) {
		response.body.destroy();
		throw new Error(`HTTP ${response.status} from "${url}".`);
	}

	return { response, url: parsed.toString() };
}

/**
 * Connects to the address that was checked, keeping the hostname for the Host header and the TLS
 * handshake, so the name is never resolved a second time between the check and the connection.
 */
function requestPinnedAddress(
	target: URL,
	address: string,
	{ method = 'GET', headers, body }: PinnedRequest,
	signal: AbortSignal | undefined,
): Promise<PinnedResponse> {
	const isHttps = target.protocol === 'https:';
	const hostname = target.hostname.replace(/^\[|\]$/g, '');
	return new Promise((resolve, reject) => {
		const request = (isHttps ? https : http).request(
			{
				host: address,
				servername: isHttps && net.isIP(hostname) === 0 ? hostname : undefined,
				port: target.port || (isHttps ? 443 : 80),
				path: `${target.pathname}${target.search}`,
				method,
				headers: { ...headers, host: target.host },
				signal,
			},
			(response) =>
				resolve({
					status: response.statusCode ?? 0,
					location: response.headers.location,
					contentType: response.headers['content-type'],
					headers: response.headers,
					body: decodedBody(response),
				}),
		);
		request.on('error', reject);
		request.end(body);
	});
}

/** Ties the connection and its decoder together, so a dropped connection fails the body and closing the body closes the connection. */
function decodedBody(response: http.IncomingMessage): Readable {
	const decoder = decoderFor(response.headers['content-encoding']);
	return decoder ? pipeline(response, decoder, () => undefined) : response;
}

function decoderFor(contentEncoding: string | undefined): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
	switch (contentEncoding?.toLowerCase()) {
		case 'gzip':
			return zlib.createGunzip();
		case 'deflate':
			return zlib.createInflate();
		case 'br':
			return zlib.createBrotliDecompress();
		default:
			return null;
	}
}

async function readBodyBytes(body: Readable, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of body) {
		totalBytes += (chunk as Buffer).byteLength;
		if (totalBytes > maxBytes) {
			body.destroy();
			throw new Error(`Response exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit.`);
		}
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

export function parseAndValidateGeoJson(text: string): GeoJsonValidationResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('Response is not valid JSON.');
	}
	return validateGeoJson(parsed);
}
