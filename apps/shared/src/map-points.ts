import type * as displayMap from './tools/display-map';

export interface MapPoint {
	latitude: number;
	longitude: number;
	row: Record<string, unknown>;
}

export interface MapBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

/** Web Mercator clamps latitudes beyond this, so points above it would all collapse onto the map edge. */
export const MERCATOR_MAX_LATITUDE = 85.051129;

/** The map UI renders at most this many points; the tool warns the model when a result exceeds it. */
export const MAX_MAP_POINTS = 5000;

/** Resolves a key to the matching column name, preferring an exact match before case-insensitive lookup. Falls back to the original key. */
export function resolveColumnName(columns: string[], key: string): string {
	if (columns.includes(key)) {
		return key;
	}
	const lower = key.toLowerCase();
	const match = columns.find((column) => column.toLowerCase() === lower);
	return match ?? key;
}

/** Resolves a config key to the matching key in the data, ignoring case. Falls back to the original key. */
export function resolveDataKey(data: Record<string, unknown>[], key: string | undefined): string {
	if (key === undefined) {
		return '';
	}
	const row = data[0];
	if (!row) {
		return key;
	}
	return resolveColumnName(Object.keys(row), key);
}

/** Resolves the configured column keys against the actual query result columns, ignoring case. */
export function resolveMapConfig(rows: Record<string, unknown>[], config: displayMap.Input): displayMap.Input {
	return {
		...config,
		latitude_key: resolveDataKey(rows, config.latitude_key),
		longitude_key: resolveDataKey(rows, config.longitude_key),
		label_key: config.label_key && resolveDataKey(rows, config.label_key),
		tooltip_keys: config.tooltip_keys?.map((key) => resolveDataKey(rows, key)),
	};
}

export function buildMapPoints(rows: Record<string, unknown>[], config: displayMap.Input): MapPoint[] {
	return rows
		.map((row) => ({
			latitude: parseCoordinate(row[config.latitude_key]),
			longitude: parseCoordinate(row[config.longitude_key]),
			row,
		}))
		.filter(
			(point): point is MapPoint =>
				point.latitude !== null &&
				point.longitude !== null &&
				Math.abs(point.latitude) <= MERCATOR_MAX_LATITUDE &&
				Math.abs(point.longitude) <= 180,
		);
}

/**
 * Computes the smallest bounds covering the points. Longitudes wrap at the
 * antimeridian: for points at 179° and -179° this returns [179, 181] (a 2°
 * span, which map libraries accept) instead of the naive [-179, 179].
 */
export function computeMapBounds(points: MapPoint[]): MapBounds | null {
	if (points.length === 0) {
		return null;
	}

	let south = Infinity;
	let north = -Infinity;
	for (const point of points) {
		south = Math.min(south, point.latitude);
		north = Math.max(north, point.latitude);
	}

	const longitudes = [...new Set(points.map((point) => point.longitude))].sort((a, b) => a - b);
	if (longitudes.length === 1) {
		return { west: longitudes[0], south, east: longitudes[0], north };
	}

	let largestGap = longitudes[0] + 360 - longitudes[longitudes.length - 1];
	let largestGapIndex = longitudes.length - 1;
	for (let i = 0; i < longitudes.length - 1; i++) {
		const gap = longitudes[i + 1] - longitudes[i];
		if (gap > largestGap) {
			largestGap = gap;
			largestGapIndex = i;
		}
	}

	const crossesAntimeridian = largestGapIndex !== longitudes.length - 1;
	const west = longitudes[(largestGapIndex + 1) % longitudes.length];
	const east = longitudes[largestGapIndex] + (crossesAntimeridian ? 360 : 0);
	return { west, south, east, north };
}

/**
 * Accepts only numbers and decimal-number strings. A blanket `Number()` coercion would turn
 * null/blank into 0 (fabricated points at (0,0)), booleans into 0/1 and dates into timestamps.
 */
function parseCoordinate(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
