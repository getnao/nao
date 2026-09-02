import { logger } from './logger';
import { type Fit, VIEW_HEIGHT, VIEW_WIDTH } from './static-map-svg';

const TILE_SIZE = 256;
const MAX_ZOOM = 10;
const MAX_TILES = 24;
export const TILE_BYTE_BUDGET = 400 * 1024;
export const TOTAL_BASEMAP_BYTE_BUDGET = 400 * 1024;

export function basemapByteBudgetForCount(mapCount: number): number {
	return Math.min(TILE_BYTE_BUDGET, Math.floor(TOTAL_BASEMAP_BYTE_BUDGET / Math.max(1, mapCount)));
}
const FETCH_TIMEOUT_MS = 4000;
const TILE_CACHE_MAX = 512;

export const BASEMAP_TILE_URL =
	process.env.NAO_STORY_MAP_RASTER_URL || 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export const BASEMAP_ATTRIBUTION = process.env.NAO_STORY_MAP_RASTER_ATTRIBUTION || '\u00a9 OpenStreetMap \u00a9 CARTO';
const BASEMAP_SUBDOMAINS = (process.env.NAO_STORY_MAP_RASTER_SUBDOMAINS || 'abcd').split('');

export interface BasemapTile {
	href: string;
	x: number;
	y: number;
	size: number;
}

export interface Basemap {
	tiles: BasemapTile[];
	attribution: string;
}

const tileCache = new Map<string, string | null>();

let fetchEnabled = !process.env.VITEST;

export function setBasemapFetchEnabledForTests(enabled: boolean): void {
	fetchEnabled = enabled;
}

export async function buildBasemapTiles(fit: Fit, byteBudget: number = TILE_BYTE_BUDGET): Promise<Basemap | null> {
	if (!fetchEnabled) {
		return null;
	}
	let reason = 'no zoom level produced any tiles';
	for (let zoom = pickZoom(fit); zoom >= 0; zoom--) {
		const coords = tileCoords(fit, zoom);
		if (coords.length === 0) {
			continue;
		}
		if (coords.length > MAX_TILES) {
			reason = `too many tiles at zoom ${zoom} (${coords.length} > ${MAX_TILES})`;
			continue;
		}
		const result = await fetchTiles(coords, zoom, fit, byteBudget);
		if (result.tiles.length > 0) {
			return { tiles: result.tiles, attribution: BASEMAP_ATTRIBUTION };
		}
		reason = result.budgetExceeded
			? `tile payload exceeded the ${byteBudget}-byte budget at zoom ${zoom}`
			: `all ${result.requested} tile request(s) failed at zoom ${zoom} (network/timeout or non-image response)`;
	}
	logger.warn(`Static map basemap unavailable, falling back to plain backdrop: ${reason}`, {
		source: 'system',
		context: { tileUrl: sanitizeTileUrlForLog(BASEMAP_TILE_URL), byteBudget },
	});
	return null;
}

function sanitizeTileUrlForLog(url: string): string {
	const match = url.match(/^([a-zA-Z][\w+.-]*:\/\/)(?:[^/?#]*@)?([^/?#]*)/);
	return match ? `${match[1]}${match[2]}` : '[redacted]';
}

interface TileFetchResult {
	tiles: BasemapTile[];
	requested: number;
	budgetExceeded: boolean;
}

interface TileCoord {
	tx: number;
	ty: number;
}

function pickZoom(fit: Fit): number {
	const natural = Math.round(Math.log2(fit.scale / TILE_SIZE));
	return Math.max(0, Math.min(MAX_ZOOM, natural));
}

function tileCoords(fit: Fit, zoom: number): TileCoord[] {
	const tiles = 2 ** zoom;
	const nxMin = (0 - fit.offsetX) / fit.scale;
	const nxMax = (VIEW_WIDTH - fit.offsetX) / fit.scale;
	const nyMin = (0 - fit.offsetY) / fit.scale;
	const nyMax = (VIEW_HEIGHT - fit.offsetY) / fit.scale;
	const txMin = Math.floor(nxMin * tiles);
	const txMax = Math.floor(nxMax * tiles);
	const tyMin = clampTile(Math.floor(nyMin * tiles), tiles);
	const tyMax = clampTile(Math.floor(nyMax * tiles), tiles);
	const coords: TileCoord[] = [];
	for (let ty = tyMin; ty <= tyMax; ty++) {
		for (let tx = txMin; tx <= txMax; tx++) {
			coords.push({ tx, ty });
		}
	}
	return coords;
}

function clampTile(value: number, tiles: number): number {
	return Math.max(0, Math.min(tiles - 1, value));
}

async function fetchTiles(coords: TileCoord[], zoom: number, fit: Fit, byteBudget: number): Promise<TileFetchResult> {
	const tiles = 2 ** zoom;
	const svgSize = (1 / tiles) * fit.scale;
	const results = await Promise.all(
		coords.map(async ({ tx, ty }) => {
			const dataUri = await fetchTile(wrapTile(tx, tiles), ty, zoom);
			if (!dataUri) {
				return null;
			}
			return {
				href: dataUri,
				x: round((tx / tiles) * fit.scale + fit.offsetX),
				y: round((ty / tiles) * fit.scale + fit.offsetY),
				size: round(svgSize),
			};
		}),
	);
	const tilesOut: BasemapTile[] = [];
	const seen = new Set<string>();
	let bytes = 0;
	for (const tile of results) {
		if (!tile) {
			continue;
		}
		// Wrapped world copies reuse the same image, so only unique tiles count toward the payload budget.
		if (!seen.has(tile.href)) {
			seen.add(tile.href);
			bytes += tile.href.length;
			if (bytes > byteBudget) {
				return { tiles: [], requested: coords.length, budgetExceeded: true };
			}
		}
		tilesOut.push(tile);
	}
	return { tiles: tilesOut, requested: coords.length, budgetExceeded: false };
}

function wrapTile(value: number, tiles: number): number {
	return ((value % tiles) + tiles) % tiles;
}

async function fetchTile(tx: number, ty: number, zoom: number): Promise<string | null> {
	const url = tileUrl(tx, ty, zoom);
	if (tileCache.has(url)) {
		return tileCache.get(url) ?? null;
	}
	const dataUri = await requestTile(url);
	rememberTile(url, dataUri);
	return dataUri;
}

async function requestTile(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			return null;
		}
		const contentType = response.headers.get('content-type') ?? 'image/png';
		if (!contentType.startsWith('image/')) {
			return null;
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		return `data:${contentType};base64,${buffer.toString('base64')}`;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function tileUrl(tx: number, ty: number, zoom: number): string {
	const subdomain = BASEMAP_SUBDOMAINS[(tx + ty) % BASEMAP_SUBDOMAINS.length] ?? 'a';
	return BASEMAP_TILE_URL.replace('{s}', subdomain)
		.replace('{z}', String(zoom))
		.replace('{x}', String(tx))
		.replace('{y}', String(ty))
		.replace('{r}', '@2x');
}

function rememberTile(url: string, value: string | null): void {
	if (tileCache.size >= TILE_CACHE_MAX) {
		const oldest = tileCache.keys().next().value;
		if (oldest !== undefined) {
			tileCache.delete(oldest);
		}
	}
	tileCache.set(url, value);
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
