import dns from 'dns/promises';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import net from 'net';

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
	{ start: ip4ToInt('192.168.0.0'), end: ip4ToInt('192.168.255.255') },
	{ start: ip4ToInt('198.18.0.0'), end: ip4ToInt('198.19.255.255') },
	{ start: ip4ToInt('224.0.0.0'), end: ip4ToInt('255.255.255.255') },
];

const PRIVATE_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local', '.arpa'];

export interface SafeFetchResult {
	text: string;
	url: string;
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
		throw new Error(`Access to private address "${hostname}" is not allowed.`);
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
		throw new Error(`Hostname "${hostname}" resolves to a private IP address, which is not allowed.`);
	}
	return addresses[0];
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<string> {
	return (await safeFetchWithUrl(url, options)).text;
}

export async function safeFetchWithUrl(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
	return fetchFollowingRedirects(url, options, 0);
}

async function fetchFollowingRedirects(
	url: string,
	options: SafeFetchOptions,
	redirectCount: number,
): Promise<SafeFetchResult> {
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

	await assertSafeHost(parsed.hostname);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(parsed.toString(), {
			signal: controller.signal,
			redirect: 'manual',
			headers: options.headers,
		});
	} catch (err) {
		clearTimeout(timer);
		throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		clearTimeout(timer);
	}

	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get('location');
		if (!location) {
			throw new Error('Redirect without location header.');
		}
		return fetchFollowingRedirects(new URL(location, parsed).toString(), options, redirectCount + 1);
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from "${url}".`);
	}

	return { text: await readBodyText(response, options.maxBytes ?? MAX_BYTES), url: parsed.toString() };
}

async function readBodyText(response: Response, maxBytes: number): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('No response body.');
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				reader.cancel();
				throw new Error(`Response exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit.`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const decoder = new TextDecoder();
	return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
}

export interface GeoJsonValidationResult {
	geojson: FeatureCollection;
	propertyKeys: string[];
	featureCount: number;
}

export function parseAndValidateGeoJson(text: string): GeoJsonValidationResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('Response is not valid JSON.');
	}

	const geojson = normalizeToFeatureCollection(parsed);

	const propertyKeySet = new Set<string>();
	for (const feature of geojson.features) {
		if (feature.properties) {
			for (const key of Object.keys(feature.properties)) {
				propertyKeySet.add(key);
			}
		}
	}

	return {
		geojson,
		propertyKeys: [...propertyKeySet].sort(),
		featureCount: geojson.features.length,
	};
}

function normalizeToFeatureCollection(value: unknown): FeatureCollection {
	if (typeof value !== 'object' || value === null) {
		throw new Error('GeoJSON must be an object.');
	}
	const record = value as Record<string, unknown>;

	if (record.type === 'FeatureCollection') {
		if (!Array.isArray(record.features)) {
			throw new Error('FeatureCollection must have a features array.');
		}
		return value as FeatureCollection;
	}

	if (record.type === 'Feature') {
		return { type: 'FeatureCollection', features: [value as Feature] };
	}

	if (isGeometry(record)) {
		return {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: value as Geometry, properties: {} }],
		};
	}

	throw new Error('Response is not a valid GeoJSON FeatureCollection, Feature, or Geometry.');
}

function isGeometry(value: Record<string, unknown>): boolean {
	const geometryTypes = [
		'Point',
		'MultiPoint',
		'LineString',
		'MultiLineString',
		'Polygon',
		'MultiPolygon',
		'GeometryCollection',
	];
	return typeof value.type === 'string' && geometryTypes.includes(value.type);
}
