import { describe, expect, it } from 'vitest';

import type { MapFeatureCollection } from '../src/map';
import {
	BUBBLE_MAX_RADIUS,
	BUBBLE_MIN_RADIUS,
	buildChoroplethEntries,
	buildMapPoints,
	CHOROPLETH_MAX_OPACITY,
	CHOROPLETH_MIN_OPACITY,
	choroplethOpacity,
	choroplethOpacityExpression,
	choroplethTooltipKeys,
	choroplethValueDomain,
	computeMapBounds,
	describeBoundarySource,
	indexBoundaries,
	normalizeRegionId,
	numericDomain,
	parseGeoJson,
	pointTooltipKeys,
	resolveColumnName,
	resolveMapConfig,
	scaleBubbleRadius,
	withOpacity,
} from '../src/map';
import type * as displayMap from '../src/tools/display-map';
import { InputSchema } from '../src/tools/display-map';

const config: displayMap.Input = {
	query_id: 'q1',
	map_type: 'points',
	latitude_key: 'lat',
	longitude_key: 'lng',
	title: 'Test map',
};

describe('InputSchema per-type requirements', () => {
	const base = { query_id: 'q1', title: 'Test map' };

	it('requires latitude and longitude for points and scatter_bubble', () => {
		expect(InputSchema.safeParse({ ...base, map_type: 'points' }).success).toBe(false);
		expect(InputSchema.safeParse({ ...base, map_type: 'scatter_bubble', size_key: 'pop' }).success).toBe(false);
		expect(
			InputSchema.safeParse({ ...base, map_type: 'points', latitude_key: 'lat', longitude_key: 'lng' }).success,
		).toBe(true);
	});

	it('additionally requires size_key for scatter_bubble', () => {
		const coords = { latitude_key: 'lat', longitude_key: 'lng' };
		expect(InputSchema.safeParse({ ...base, map_type: 'scatter_bubble', ...coords }).success).toBe(false);
		expect(InputSchema.safeParse({ ...base, map_type: 'scatter_bubble', ...coords, size_key: 'pop' }).success).toBe(
			true,
		);
	});

	it('requires value_key and a boundary source for choropleth', () => {
		expect(InputSchema.safeParse({ ...base, map_type: 'choropleth' }).success).toBe(false);
		expect(InputSchema.safeParse({ ...base, map_type: 'choropleth', value_key: 'sales' }).success).toBe(false);
		expect(
			InputSchema.safeParse({
				...base,
				map_type: 'choropleth',
				value_key: 'sales',
				region_boundaries: 'world_countries',
				region_key: 'country',
			}).success,
		).toBe(true);
		expect(
			InputSchema.safeParse({ ...base, map_type: 'choropleth', value_key: 'sales', geometry_key: 'geom' })
				.success,
		).toBe(true);
	});

	it('rejects a choropleth with region_boundaries but no region_key', () => {
		const result = InputSchema.safeParse({
			...base,
			map_type: 'choropleth',
			value_key: 'sales',
			region_boundaries: 'world_countries',
		});
		expect(result.success).toBe(false);
	});

	it('ignores unrelated columns when validating a point map', () => {
		const result = InputSchema.safeParse({
			...base,
			map_type: 'points',
			latitude_key: 'lat',
			longitude_key: 'lng',
			value_key: 'sales',
		});
		expect(result.success).toBe(true);
	});
});

describe('buildMapPoints', () => {
	it('builds points from numeric coordinates', () => {
		const rows = [{ lat: 48.85, lng: 2.35 }];
		expect(buildMapPoints(rows, config)).toEqual([{ latitude: 48.85, longitude: 2.35, row: rows[0] }]);
	});

	it('parses string coordinates', () => {
		const points = buildMapPoints([{ lat: '48.85', lng: '2.35' }], config);
		expect(points).toEqual([expect.objectContaining({ latitude: 48.85, longitude: 2.35 })]);
	});

	it('drops rows with null, empty or blank coordinates instead of coercing them to 0', () => {
		const rows = [
			{ lat: null, lng: 2.35 },
			{ lat: 48.85, lng: undefined },
			{ lat: '', lng: 2.35 },
			{ lat: 48.85, lng: '   ' },
		];
		expect(buildMapPoints(rows, config)).toEqual([]);
	});

	it('keeps legitimate zero coordinates', () => {
		const points = buildMapPoints([{ lat: 0, lng: 0 }], config);
		expect(points).toEqual([expect.objectContaining({ latitude: 0, longitude: 0 })]);
	});

	it('drops non-numeric coordinates', () => {
		expect(buildMapPoints([{ lat: 'Paris', lng: 2.35 }], config)).toEqual([]);
	});

	it('drops coercible non-numeric types instead of plotting them', () => {
		const rows = [
			{ lat: true, lng: false },
			{ lat: new Date('2026-01-01'), lng: 2.35 },
			{ lat: [48.85], lng: 2.35 },
		];
		expect(buildMapPoints(rows, config)).toEqual([]);
	});

	it('drops out-of-range coordinates', () => {
		const rows = [
			{ lat: 91, lng: 2.35 },
			{ lat: -90.5, lng: 2.35 },
			{ lat: 48.85, lng: 180.1 },
			{ lat: 48.85, lng: -181 },
		];
		expect(buildMapPoints(rows, config)).toEqual([]);
	});

	it('drops latitudes beyond the Web Mercator limit, which would collapse onto the map edge', () => {
		const rows = [
			{ lat: 86, lng: 2.35 },
			{ lat: -90, lng: 2.35 },
		];
		expect(buildMapPoints(rows, config)).toEqual([]);
	});

	it('keeps boundary coordinates', () => {
		const rows = [{ lat: 85.051129, lng: -180 }];
		expect(buildMapPoints(rows, config)).toHaveLength(1);
	});
});

describe('resolveColumnName', () => {
	it('prefers an exact match over a case-insensitive one', () => {
		expect(resolveColumnName(['Lat', 'lat'], 'lat')).toBe('lat');
		expect(resolveColumnName(['lat', 'LAT'], 'LAT')).toBe('LAT');
	});

	it('falls back to a case-insensitive match, then to the original key', () => {
		expect(resolveColumnName(['LAT'], 'lat')).toBe('LAT');
		expect(resolveColumnName(['city'], 'lat')).toBe('lat');
	});
});

describe('resolveMapConfig', () => {
	it('resolves configured keys against uppercase result columns', () => {
		const rows = [{ LAT: 48.85, LNG: 2.35, CITY: 'Paris', COUNT: 3 }];
		const resolved = resolveMapConfig(rows, {
			...config,
			label_key: 'city',
			tooltip_keys: ['count'],
		});
		expect(resolved.latitude_key).toBe('LAT');
		expect(resolved.longitude_key).toBe('LNG');
		expect(resolved.label_key).toBe('CITY');
		expect(resolved.tooltip_keys).toEqual(['COUNT']);
	});

	it('keeps keys unchanged when they match or when no column matches', () => {
		const rows = [{ lat: 1, lng: 2 }];
		const resolved = resolveMapConfig(rows, { ...config, label_key: 'missing' });
		expect(resolved.latitude_key).toBe('lat');
		expect(resolved.label_key).toBe('missing');
	});

	it('resolves case variants of the same column to one key, so callers can detect the collision', () => {
		const rows = [{ LATITUDE: 48.85, city: 'Paris' }];
		const resolved = resolveMapConfig(rows, {
			...config,
			latitude_key: 'latitude',
			longitude_key: 'LATITUDE',
		});
		expect(resolved.latitude_key).toBe('LATITUDE');
		expect(resolved.longitude_key).toBe('LATITUDE');
	});

	it('resolves case-insensitive keys end to end with buildMapPoints', () => {
		const rows = [{ LATITUDE: 48.85, LONGITUDE: 2.35 }];
		const resolved = resolveMapConfig(rows, {
			...config,
			latitude_key: 'latitude',
			longitude_key: 'longitude',
		});
		expect(buildMapPoints(rows, resolved)).toHaveLength(1);
	});
});

describe('computeMapBounds', () => {
	const point = (latitude: number, longitude: number) => ({ latitude, longitude, row: {} });

	it('returns null for no points', () => {
		expect(computeMapBounds([])).toBeNull();
	});

	it('returns a degenerate box for a single point', () => {
		expect(computeMapBounds([point(48.85, 2.35)])).toEqual({ west: 2.35, south: 48.85, east: 2.35, north: 48.85 });
	});

	it('returns plain min/max bounds for points on one side of the antimeridian', () => {
		const bounds = computeMapBounds([point(48.85, 2.35), point(52.5, 13.4), point(40.4, -3.7)]);
		expect(bounds).toEqual({ west: -3.7, south: 40.4, east: 13.4, north: 52.5 });
	});

	it('wraps across the antimeridian instead of spanning the whole world', () => {
		const bounds = computeMapBounds([point(-17, 179), point(-18, -179)]);
		expect(bounds).toEqual({ west: 179, south: -18, east: 181, north: -17 });
	});

	it('keeps the wrapped interval minimal with several points near the antimeridian', () => {
		const bounds = computeMapBounds([point(60, 170), point(62, 179), point(61, -170)]);
		expect(bounds).toEqual({ west: 170, south: 60, east: 190, north: 62 });
	});
});

describe('numericDomain', () => {
	it('ignores non-finite values and returns min/max', () => {
		expect(numericDomain([3, null, 1, undefined, 5, NaN])).toEqual({ min: 1, max: 5 });
	});

	it('returns null when no finite values are present', () => {
		expect(numericDomain([null, undefined, NaN])).toBeNull();
	});
});

describe('scaleBubbleRadius', () => {
	const domain = { min: 0, max: 100 };

	it('maps the extremes to the min and max radius', () => {
		expect(scaleBubbleRadius(0, domain)).toBeCloseTo(BUBBLE_MIN_RADIUS);
		expect(scaleBubbleRadius(100, domain)).toBeCloseTo(BUBBLE_MAX_RADIUS);
	});

	it('uses a square-root (area-proportional) scale for intermediate values', () => {
		const mid = scaleBubbleRadius(25, domain);
		expect(mid).toBeCloseTo(BUBBLE_MIN_RADIUS + (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS) * 0.5);
	});

	it('falls back to the min radius for a null value and the max radius for a degenerate domain', () => {
		expect(scaleBubbleRadius(null, domain)).toBe(BUBBLE_MIN_RADIUS);
		expect(scaleBubbleRadius(5, { min: 5, max: 5 })).toBe(BUBBLE_MAX_RADIUS);
	});

	it('honours a custom maximum radius', () => {
		expect(scaleBubbleRadius(100, domain, 40)).toBeCloseTo(40);
	});
});

describe('normalizeRegionId', () => {
	it('lowercases and trims, returning null for empty values', () => {
		expect(normalizeRegionId('  FR ')).toBe('fr');
		expect(normalizeRegionId(75)).toBe('75');
		expect(normalizeRegionId('')).toBeNull();
		expect(normalizeRegionId(null)).toBeNull();
	});
});

describe('parseGeoJson', () => {
	it('parses a geometry from a JSON string', () => {
		expect(parseGeoJson('{"type":"Point","coordinates":[1,2]}')).toEqual({ type: 'Point', coordinates: [1, 2] });
	});

	it('unwraps a Feature to its geometry', () => {
		const feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} };
		expect(parseGeoJson(feature)).toEqual({ type: 'Polygon', coordinates: [] });
	});

	it('returns null for invalid or non-geometry input', () => {
		expect(parseGeoJson('not json')).toBeNull();
		expect(parseGeoJson({ type: 'Feature' })).toBeNull();
		expect(parseGeoJson(null)).toBeNull();
	});
});

describe('choroplethOpacity', () => {
	const domain = { min: 0, max: 100 };

	it('maps the domain ends to the min and max opacity', () => {
		expect(choroplethOpacity(0, domain)).toBeCloseTo(CHOROPLETH_MIN_OPACITY);
		expect(choroplethOpacity(100, domain)).toBeCloseTo(CHOROPLETH_MAX_OPACITY);
	});

	it('interpolates linearly for values inside the domain', () => {
		expect(choroplethOpacity(50, domain)).toBeCloseTo((CHOROPLETH_MIN_OPACITY + CHOROPLETH_MAX_OPACITY) / 2);
	});

	it('clamps out-of-range values and treats null as the domain minimum', () => {
		expect(choroplethOpacity(200, domain)).toBeCloseTo(CHOROPLETH_MAX_OPACITY);
		expect(choroplethOpacity(-50, domain)).toBeCloseTo(CHOROPLETH_MIN_OPACITY);
		expect(choroplethOpacity(null, domain)).toBeCloseTo(CHOROPLETH_MIN_OPACITY);
	});

	it('falls back to the mid opacity for a degenerate or missing domain', () => {
		const mid = (CHOROPLETH_MIN_OPACITY + CHOROPLETH_MAX_OPACITY) / 2;
		expect(choroplethOpacity(5, { min: 5, max: 5 })).toBeCloseTo(mid);
		expect(choroplethOpacity(5, null)).toBeCloseTo(mid);
	});
});

describe('choroplethOpacityExpression', () => {
	it('encodes the linear interpolation across the domain for the map layers', () => {
		expect(choroplethOpacityExpression({ min: 0, max: 100 })).toEqual([
			'interpolate',
			['linear'],
			['coalesce', ['get', 'value'], 0],
			0,
			CHOROPLETH_MIN_OPACITY,
			100,
			CHOROPLETH_MAX_OPACITY,
		]);
	});

	it('falls back to a flat mid opacity for a degenerate or missing domain', () => {
		const mid = (CHOROPLETH_MIN_OPACITY + CHOROPLETH_MAX_OPACITY) / 2;
		expect(choroplethOpacityExpression({ min: 5, max: 5 })).toBe(mid);
		expect(choroplethOpacityExpression(null)).toBe(mid);
	});
});

describe('choroplethValueDomain', () => {
	const entry = (value: number | null, region: string | null, geometry: Record<string, unknown> | null = null) => ({
		region,
		value,
		geometry,
		row: {},
	});

	it('spans the values of entries that can be shaded', () => {
		const entries = [entry(10, 'fr'), entry(30, 'de'), entry(20, null, { type: 'Point', coordinates: [1, 2] })];
		expect(choroplethValueDomain(entries)).toEqual({ min: 10, max: 30 });
	});

	it('excludes entries with neither a region nor a geometry so live and export scales match', () => {
		const entries = [entry(10, 'fr'), entry(999, null)];
		expect(choroplethValueDomain(entries)).toEqual({ min: 10, max: 10 });
	});

	it('returns null when nothing can be shaded', () => {
		expect(choroplethValueDomain([entry(5, null), entry(null, 'fr')])).toBeNull();
	});
});

describe('withOpacity', () => {
	it('applies the alpha to an rgb/rgba color', () => {
		expect(withOpacity('rgb(10, 20, 30)', 0.5)).toBe('rgba(10, 20, 30, 0.5)');
		expect(withOpacity('rgba(10, 20, 30, 1)', 0.5)).toBe('rgba(10, 20, 30, 0.5)');
	});

	it('applies the alpha to a 6-digit hex color', () => {
		expect(withOpacity('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
	});

	it('expands and applies the alpha to a 3-digit hex color', () => {
		expect(withOpacity('#f00', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
	});

	it('returns the trimmed input unchanged when the color is not recognised', () => {
		expect(withOpacity('  goldenrod ', 0.5)).toBe('goldenrod');
	});
});

describe('choroplethTooltipKeys', () => {
	const base: displayMap.Input = { query_id: 'q1', map_type: 'choropleth', title: '' };

	it('lists the value column first, then extra tooltip columns, without the label column', () => {
		const config = { ...base, value_key: 'sales', tooltip_keys: ['region', 'sales', 'label'], label_key: 'label' };
		expect(choroplethTooltipKeys(config)).toEqual(['sales', 'region']);
	});

	it('drops falsy and duplicate keys', () => {
		const config = { ...base, value_key: 'sales', tooltip_keys: ['sales', ''] };
		expect(choroplethTooltipKeys(config)).toEqual(['sales']);
	});
});

describe('pointTooltipKeys', () => {
	const base: displayMap.Input = { query_id: 'q1', map_type: 'points', title: '' };

	it('returns the tooltip columns without the label column', () => {
		const config = { ...base, tooltip_keys: ['count', 'city'], label_key: 'city' };
		expect(pointTooltipKeys(config)).toEqual(['count']);
	});

	it('appends the bubble size column when it is not already present', () => {
		const config = { ...base, map_type: 'scatter_bubble' as const, tooltip_keys: ['count'], size_key: 'pop' };
		expect(pointTooltipKeys(config)).toEqual(['count', 'pop']);
	});

	it('does not duplicate the size column or add it when it is the label column', () => {
		expect(
			pointTooltipKeys({ ...base, map_type: 'scatter_bubble', tooltip_keys: ['pop'], size_key: 'pop' }),
		).toEqual(['pop']);
		expect(
			pointTooltipKeys({
				...base,
				map_type: 'scatter_bubble',
				tooltip_keys: [],
				size_key: 'city',
				label_key: 'city',
			}),
		).toEqual([]);
	});
});

describe('buildChoroplethEntries', () => {
	const base: displayMap.Input = {
		query_id: 'q1',
		map_type: 'choropleth',
		value_key: 'sales',
		region_key: 'country',
		title: 'Sales by country',
	};

	it('reads the value and normalises the join region per row', () => {
		const entries = buildChoroplethEntries([{ country: 'FR', sales: '120' }], base);
		expect(entries).toEqual([{ region: 'fr', value: 120, geometry: null, row: { country: 'FR', sales: '120' } }]);
	});

	it('parses an inline geometry column when geometry_key is set', () => {
		const config = { ...base, region_key: undefined, geometry_key: 'geom' };
		const entries = buildChoroplethEntries([{ geom: '{"type":"Point","coordinates":[1,2]}', sales: 5 }], config);
		expect(entries[0].geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
		expect(entries[0].value).toBe(5);
	});
});

describe('describeBoundarySource', () => {
	const base: displayMap.Input = { query_id: 'q1', map_type: 'choropleth', title: '' };

	it('returns null for non-choropleth maps', () => {
		expect(describeBoundarySource({ ...base, map_type: 'points' })).toBeNull();
	});

	it('returns kind "url" when boundaries_url is set', () => {
		const result = describeBoundarySource({ ...base, boundaries_url: 'https://example.com/regions.geojson' });
		expect(result).toEqual({ label: 'https://example.com/regions.geojson', kind: 'url' });
	});

	it('returns kind "url" ahead of geometry_key when both are set', () => {
		const result = describeBoundarySource({
			...base,
			boundaries_url: 'https://example.com/regions.geojson',
			geometry_key: 'geom',
		});
		expect(result?.kind).toBe('url');
	});

	it('returns kind "inline" for geometry_key', () => {
		const result = describeBoundarySource({ ...base, geometry_key: 'geom' });
		expect(result).toEqual({ label: 'Inline geometry (geom)', kind: 'inline' });
	});

	it('returns kind "builtin" for world_countries', () => {
		const result = describeBoundarySource({ ...base, region_boundaries: 'world_countries' });
		expect(result).toEqual({ label: 'World countries', kind: 'builtin' });
	});

	it('returns kind "custom" for a custom boundary set key', () => {
		const customSets = [
			{
				key: 'us_states',
				label: 'US States',
				url: 'https://example.com',
				joinProperty: 'NAME',
				regionKeyHint: '',
			},
		];
		const result = describeBoundarySource({ ...base, region_boundaries: 'us_states' }, customSets);
		expect(result).toEqual({ label: 'US States', kind: 'custom' });
	});
});

describe('indexBoundaries', () => {
	const geometry = {
		type: 'Polygon' as const,
		coordinates: [
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 0],
			],
		],
	};

	const boundaries: MapFeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{ type: 'Feature', geometry, properties: { iso: 'FR', name: 'France' } },
			{ type: 'Feature', geometry, properties: { iso: 'DE', name: 'Germany' } },
		],
	};

	it('indexes by the specified joinProps', () => {
		const index = indexBoundaries(boundaries, ['iso']);
		expect(index.has('fr')).toBe(true);
		expect(index.has('de')).toBe(true);
		expect(index.has('france')).toBe(false);
	});

	it('auto-matches all properties when joinProps is undefined', () => {
		const index = indexBoundaries(boundaries);
		expect(index.has('fr')).toBe(true);
		expect(index.has('france')).toBe(true);
		expect(index.has('de')).toBe(true);
		expect(index.has('germany')).toBe(true);
	});

	it('normalises keys to lowercase', () => {
		const index = indexBoundaries(boundaries, ['name']);
		expect(index.has('france')).toBe(true);
		expect(index.has('FRANCE')).toBe(false);
	});

	it('does not overwrite an already-indexed key with a different property value', () => {
		const index = indexBoundaries(boundaries, ['iso', 'name']);
		expect(index.get('fr')).toBe(geometry);
	});
});
