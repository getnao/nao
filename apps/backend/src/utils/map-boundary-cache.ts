import type { FeatureCollection } from 'geojson';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — boundaries are quasi-static
const MAX_ENTRIES = 256;

interface CacheEntry {
	geojson: FeatureCollection;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedBoundary(url: string): FeatureCollection | null {
	const entry = cache.get(url);
	if (!entry) {
		return null;
	}
	if (Date.now() > entry.expiresAt) {
		cache.delete(url);
		return null;
	}
	return entry.geojson;
}

export function setCachedBoundary(url: string, geojson: FeatureCollection): void {
	cache.set(url, { geojson, expiresAt: Date.now() + TTL_MS });
	evictStaleAndOverflow();
}

function evictStaleAndOverflow(): void {
	const now = Date.now();
	for (const [url, entry] of cache) {
		if (now > entry.expiresAt) {
			cache.delete(url);
		}
	}
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		cache.delete(oldest);
	}
}
