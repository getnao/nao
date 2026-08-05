import dns from 'dns/promises';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import net from 'net';

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const PRIVATE_IPV4_RANGES = [
	{ start: ip4ToInt('10.0.0.0'), end: ip4ToInt('10.255.255.255') },
	{ start: ip4ToInt('100.64.0.0'), end: ip4ToInt('100.127.255.255') },
	{ start: ip4ToInt('127.0.0.0'), end: ip4ToInt('127.255.255.255') },
	{ start: ip4ToInt('169.254.0.0'), end: ip4ToInt('169.254.255.255') },
	{ start: ip4ToInt('172.16.0.0'), end: ip4ToInt('172.31.255.255') },
	{ start: ip4ToInt('192.168.0.0'), end: ip4ToInt('192.168.255.255') },
	{ start: ip4ToInt('198.18.0.0'), end: ip4ToInt('198.19.255.255') },
];

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
	const normalized = ip.toLowerCase();
	return (
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80') ||
		normalized === '::' ||
		normalized === '0:0:0:0:0:0:0:1'
	);
}

async function assertSafeHost(hostname: string): Promise<void> {
	if (net.isIPv4(hostname)) {
		if (isPrivateIPv4(hostname)) {
			throw new Error(`Access to private IP address "${hostname}" is not allowed.`);
		}
		return;
	}
	if (net.isIPv6(hostname)) {
		if (isPrivateIPv6(hostname)) {
			throw new Error(`Access to private IP address "${hostname}" is not allowed.`);
		}
		return;
	}

	let addresses: string[];
	try {
		const results = await dns.lookup(hostname, { all: true });
		addresses = results.map((r) => r.address);
	} catch {
		throw new Error(`Could not resolve hostname "${hostname}".`);
	}
	for (const address of addresses) {
		if (isPrivateIPv4(address) || isPrivateIPv6(address)) {
			throw new Error(`Hostname "${hostname}" resolves to a private IP address, which is not allowed.`);
		}
	}
}

export async function safeFetch(url: string, redirectCount = 0): Promise<string> {
	if (redirectCount > MAX_REDIRECTS) {
		throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: "${url}".`);
	}

	if (parsed.protocol !== 'https:') {
		throw new Error('Only HTTPS URLs are allowed.');
	}

	await assertSafeHost(parsed.hostname);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(parsed.toString(), {
			signal: controller.signal,
			redirect: 'manual',
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
		return safeFetch(new URL(location, parsed).toString(), redirectCount + 1);
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from "${url}".`);
	}

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
			if (totalBytes > MAX_BYTES) {
				reader.cancel();
				throw new Error(`Response exceeds the ${MAX_BYTES / 1024 / 1024} MB size limit.`);
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
