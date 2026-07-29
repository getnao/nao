import type { FeatureCollection, Geometry } from 'geojson';

import type * as displayMap from './tools/display-map';

export interface CustomBoundarySet {
	key: string;
	label: string;
	url: string;
	joinProperty: string;
	regionKeyHint: string;
	featureCount?: number;
}

export interface MapSettings {
	customBoundaries?: CustomBoundarySet[];
}

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

export const MAX_MAP_POINTS = 5000;

export function resolveColumnName(columns: string[], key: string): string {
	if (columns.includes(key)) {
		return key;
	}
	const lower = key.toLowerCase();
	const match = columns.find((column) => column.toLowerCase() === lower);
	return match ?? key;
}

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

export function resolveMapConfig(rows: Record<string, unknown>[], config: displayMap.Input): displayMap.Input {
	return {
		...config,
		latitude_key: resolveDataKey(rows, config.latitude_key),
		longitude_key: resolveDataKey(rows, config.longitude_key),
		label_key: config.label_key && resolveDataKey(rows, config.label_key),
		tooltip_keys: config.tooltip_keys?.map((key) => resolveDataKey(rows, key)),
		size_key: config.size_key && resolveDataKey(rows, config.size_key),
		value_key: config.value_key && resolveDataKey(rows, config.value_key),
		region_key: config.region_key && resolveDataKey(rows, config.region_key),
		geometry_key: config.geometry_key && resolveDataKey(rows, config.geometry_key),
	};
}

export function buildMapPoints(rows: Record<string, unknown>[], config: displayMap.Input): MapPoint[] {
	const latitudeKey = config.latitude_key ?? '';
	const longitudeKey = config.longitude_key ?? '';
	return rows
		.map((row) => ({
			latitude: parseNumericValue(row[latitudeKey]),
			longitude: parseNumericValue(row[longitudeKey]),
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

export const DEFAULT_MARKER_COLOR = '#522bff';
export const DEFAULT_MARKER_RADIUS = 5;

export const BUBBLE_MIN_RADIUS = 4;
export const BUBBLE_MAX_RADIUS = 28;

export function parseNumericValue(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

export interface NumericDomain {
	min: number;
	max: number;
}

export function numericDomain(values: (number | null | undefined)[]): NumericDomain | null {
	let min = Infinity;
	let max = -Infinity;
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			min = Math.min(min, value);
			max = Math.max(max, value);
		}
	}
	return min <= max ? { min, max } : null;
}

export function scaleBubbleRadius(
	value: number | null,
	domain: NumericDomain | null,
	maxRadius: number = BUBBLE_MAX_RADIUS,
	minRadius: number = BUBBLE_MIN_RADIUS,
): number {
	if (value === null || domain === null) {
		return minRadius;
	}
	if (domain.max === domain.min) {
		return maxRadius;
	}
	const ratio = Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
	return minRadius + (maxRadius - minRadius) * Math.sqrt(ratio);
}

export function bubbleLegendValues(domain: NumericDomain): number[] {
	return domain.min === domain.max ? [domain.max] : [domain.min, domain.max];
}

/** GeoJSON aliases the map layers build on, kept here next to the geometry parsing helpers that produce them. */
export type MapGeometry = Geometry;
export type MapFeatureCollection = FeatureCollection;

export interface ChoroplethEntry {
	region: string | null;
	value: number | null;
	geometry: MapGeometry | null;
	row: Record<string, unknown>;
}

/** Builds one entry per row for a choropleth, reading the value, the join region and any inline GeoJSON geometry. */
export function buildChoroplethEntries(rows: Record<string, unknown>[], config: displayMap.Input): ChoroplethEntry[] {
	const valueKey = config.value_key ?? '';
	const regionKey = config.region_key ?? '';
	const geometryKey = config.geometry_key ?? '';
	return rows.map((row) => ({
		region: regionKey ? normalizeRegionId(row[regionKey]) : null,
		value: parseNumericValue(row[valueKey]),
		geometry: geometryKey ? parseGeoJson(row[geometryKey]) : null,
		row,
	}));
}

export function choroplethValueDomain(entries: ChoroplethEntry[]): NumericDomain | null {
	return numericDomain(
		entries.filter((entry) => entry.geometry !== null || entry.region !== null).map((entry) => entry.value),
	);
}

/** Lowercased, trimmed region identifier, or null when empty — used on both sides of the boundary join. */
export function normalizeRegionId(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	const normalized = String(value).trim().toLowerCase();
	return normalized === '' ? null : normalized;
}

/** Parses a GeoJSON geometry from a string or object, unwrapping a Feature. Returns null when it is not a geometry. */
export function parseGeoJson(value: unknown): MapGeometry | null {
	let candidate: unknown = value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') {
			return null;
		}
		try {
			candidate = JSON.parse(trimmed);
		} catch {
			return null;
		}
	}
	if (typeof candidate !== 'object' || candidate === null) {
		return null;
	}
	const record = candidate as Record<string, unknown>;
	if (record.type === 'Feature') {
		return parseGeoJson(record.geometry);
	}
	return isMapGeometry(candidate) ? candidate : null;
}

/** Narrows an unknown value to a GeoJSON geometry, accepting single geometries and geometry collections. */
function isMapGeometry(value: unknown): value is MapGeometry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.type === 'string' && (record.coordinates !== undefined || record.geometries !== undefined);
}

type BuiltinRegionBoundaries = 'world_countries' | 'france_regions';

export const MAP_BOUNDARY_URLS: Record<BuiltinRegionBoundaries, string> = {
	world_countries:
		'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
	france_regions:
		'https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson@master/regions-version-simplifiee.geojson',
};

/** Feature properties tried, in order, to match a region_key value against a built-in boundary set. */
export const BOUNDARY_JOIN_PROPS: Record<BuiltinRegionBoundaries, string[]> = {
	world_countries: [
		'ISO_A3',
		'ISO_A2',
		'ADM0_A3',
		'ADMIN',
		'NAME',
		'NAME_LONG',
		'NAME_EN',
		'SOVEREIGNT',
		'BRK_NAME',
		'FORMAL_EN',
	],
	france_regions: ['code', 'nom'],
};

export const BUILTIN_BOUNDARY_LABELS: Record<BuiltinRegionBoundaries, string> = {
	world_countries: 'World countries',
	france_regions: 'France regions',
};

export interface BoundarySource {
	label: string;
	kind: 'builtin' | 'custom' | 'inline' | 'url';
}

export function describeBoundarySource(
	config: displayMap.Input,
	customSets?: CustomBoundarySet[],
): BoundarySource | null {
	if (config.map_type !== 'choropleth') {
		return null;
	}
	if (config.boundaries_url) {
		return { label: config.boundaries_url, kind: 'url' };
	}
	if (config.geometry_key) {
		return { label: `Inline geometry (${config.geometry_key})`, kind: 'inline' };
	}
	const key = config.region_boundaries;
	if (!key) {
		return null;
	}
	const custom = customSets?.find((set) => set.key === key);
	if (custom) {
		return { label: custom.label, kind: 'custom' };
	}
	if (key === 'world_countries' || key === 'france_regions') {
		return { label: BUILTIN_BOUNDARY_LABELS[key], kind: 'builtin' };
	}
	return { label: key, kind: 'custom' };
}

/**
 * Builds a lookup from normalised region id to geometry, used to join choropleth data rows to boundary features.
 * When joinProps is provided only those feature properties are indexed; when omitted every property is tried,
 * enabling automatic matching without knowing the GeoJSON schema ahead of time.
 */
export function indexBoundaries(boundaries: MapFeatureCollection, joinProps?: string[]): Map<string, MapGeometry> {
	const index = new Map<string, MapGeometry>();
	for (const feature of boundaries.features) {
		const properties = (feature.properties ?? {}) as Record<string, unknown>;
		const props = joinProps ?? Object.keys(properties);
		for (const prop of props) {
			const key = normalizeRegionId(properties[prop]);
			if (key && !index.has(key)) {
				index.set(key, feature.geometry);
			}
		}
	}
	return index;
}

export function resolveBoundary(
	key: string,
	customSets?: CustomBoundarySet[],
): { url: string; joinProps: string[] } | null {
	const custom = customSets?.find((s) => s.key === key);
	if (custom) {
		return { url: custom.url, joinProps: [custom.joinProperty] };
	}
	if (key === 'world_countries' || key === 'france_regions') {
		return {
			url: MAP_BOUNDARY_URLS[key],
			joinProps: BOUNDARY_JOIN_PROPS[key],
		};
	}
	return null;
}

/** Opacity range used to shade choropleth regions from the lightest to the darkest value. */
export const CHOROPLETH_MIN_OPACITY = 0.15;
export const CHOROPLETH_MAX_OPACITY = 0.85;

export function choroplethOpacity(value: number | null, domain: NumericDomain | null): number {
	if (!domain || domain.min === domain.max) {
		return (CHOROPLETH_MIN_OPACITY + CHOROPLETH_MAX_OPACITY) / 2;
	}
	const numeric = value ?? domain.min;
	const ratio = Math.max(0, Math.min(1, (numeric - domain.min) / (domain.max - domain.min)));
	return CHOROPLETH_MIN_OPACITY + (CHOROPLETH_MAX_OPACITY - CHOROPLETH_MIN_OPACITY) * ratio;
}

export function choroplethOpacityExpression(domain: NumericDomain | null): number | unknown[] {
	if (!domain || domain.min === domain.max) {
		return (CHOROPLETH_MIN_OPACITY + CHOROPLETH_MAX_OPACITY) / 2;
	}
	return [
		'interpolate',
		['linear'],
		['coalesce', ['get', 'value'], domain.min],
		domain.min,
		CHOROPLETH_MIN_OPACITY,
		domain.max,
		CHOROPLETH_MAX_OPACITY,
	];
}

export function withOpacity(color: string, opacity: number): string {
	const trimmed = color.trim();
	const rgb = trimmed.match(/rgba?\(([^)]+)\)/);
	if (rgb) {
		const [r, g, b] = rgb[1].split(',').map((part) => part.trim());
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}
	const hex = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (hex) {
		const value =
			hex[1].length === 3
				? hex[1]
						.split('')
						.map((char) => char + char)
						.join('')
				: hex[1];
		const r = parseInt(value.slice(0, 2), 16);
		const g = parseInt(value.slice(2, 4), 16);
		const b = parseInt(value.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}
	return trimmed;
}

/** Deduplicated tooltip columns for a choropleth: the value column first, then any extra tooltip columns, minus the label column. */
export function choroplethTooltipKeys(config: displayMap.Input): string[] {
	return [...new Set([config.value_key, ...(config.tooltip_keys ?? [])])].filter(
		(key): key is string => !!key && key !== config.label_key,
	);
}

/** Tooltip columns for a point/bubble map: the configured tooltip columns minus the label column, plus the bubble size column. */
export function pointTooltipKeys(config: displayMap.Input): string[] {
	const keys = (config.tooltip_keys ?? []).filter((key) => key && key !== config.label_key);
	if (
		config.map_type === 'scatter_bubble' &&
		config.size_key &&
		config.size_key !== config.label_key &&
		!keys.includes(config.size_key)
	) {
		keys.push(config.size_key);
	}
	return keys;
}
