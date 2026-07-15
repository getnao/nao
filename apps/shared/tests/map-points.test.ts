import { describe, expect, it } from 'vitest';

import { buildMapPoints, computeMapBounds, resolveColumnName, resolveMapConfig } from '../src/map-points';
import type * as displayMap from '../src/tools/display-map';

const config: displayMap.Input = {
	query_id: 'q1',
	map_type: 'points',
	latitude_key: 'lat',
	longitude_key: 'lng',
	title: 'Test map',
};

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
