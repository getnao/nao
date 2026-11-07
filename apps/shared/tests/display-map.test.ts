import { describe, expect, it } from 'vitest';

import { displayMap } from '../src/tools';

const baseInput = { query_id: 'query_1', title: 'Stores' };

describe('getMissingMapAttributes', () => {
	it('lists the coordinate and size columns a scatter_bubble map lacks', () => {
		expect(displayMap.getMissingMapAttributes({ ...baseInput, map_type: 'scatter_bubble' })).toEqual([
			'latitude_key',
			'longitude_key',
			'size_key',
		]);
	});

	it('returns nothing for a complete points map', () => {
		const input = { ...baseInput, map_type: 'points' as const, latitude_key: 'lat', longitude_key: 'lng' };
		expect(displayMap.getMissingMapAttributes(input)).toEqual([]);
	});

	it('lists the value column a choropleth lacks', () => {
		expect(displayMap.getMissingMapAttributes({ ...baseInput, map_type: 'choropleth' })).toEqual(['value_key']);
	});

	it('lists the boundary columns a choropleth with a value column lacks', () => {
		const input = { ...baseInput, map_type: 'choropleth' as const, value_key: 'sales' };
		expect(displayMap.getMissingMapAttributes(input)).toEqual([
			'region_key with region_boundaries or boundaries_url, or geometry_key',
		]);
	});

	it('ignores invalid values that are not missing columns', () => {
		const input = {
			...baseInput,
			map_type: 'choropleth' as const,
			value_key: 'sales',
			region_key: 'department',
			region_boundaries: 'custom_departments',
		};
		expect(displayMap.getMissingMapAttributes(input)).toEqual([]);
	});

	it('lists the value column a choropleth on a custom boundary set lacks', () => {
		const input = {
			...baseInput,
			map_type: 'choropleth' as const,
			region_key: 'department',
			region_boundaries: 'custom_departments',
		};
		expect(displayMap.getMissingMapAttributes(input)).toEqual(['value_key']);
	});
});
