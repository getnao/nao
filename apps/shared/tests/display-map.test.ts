import { describe, expect, it } from 'vitest';

import { displayMap } from '../src/tools';

const baseInput = { query_id: 'query_1', title: 'Stores' };
const customBoundaryChoropleth = {
	map_type: 'choropleth' as const,
	region_key: 'department',
	region_boundaries: 'custom_departments',
};

describe('getMissingMapAttributes', () => {
	it.each<{ variant: string; input: Omit<displayMap.Input, 'query_id' | 'title'>; missing: string[] }>([
		{
			variant: 'a scatter_bubble without coordinates or size',
			input: { map_type: 'scatter_bubble' },
			missing: ['latitude_key', 'longitude_key', 'size_key'],
		},
		{
			variant: 'a complete points map',
			input: { map_type: 'points', latitude_key: 'lat', longitude_key: 'lng' },
			missing: [],
		},
		{
			variant: 'a choropleth without a value column',
			input: { map_type: 'choropleth' },
			missing: ['value_key'],
		},
		{
			variant: 'a choropleth without boundaries',
			input: { map_type: 'choropleth', value_key: 'sales' },
			missing: ['region_key with region_boundaries or boundaries_url, or geometry_key'],
		},
		{
			variant: 'a complete choropleth on a custom boundary set',
			input: { ...customBoundaryChoropleth, value_key: 'sales' },
			missing: [],
		},
		{
			variant: 'a choropleth on a custom boundary set without a value column',
			input: customBoundaryChoropleth,
			missing: ['value_key'],
		},
	])('lists the columns missing from $variant', ({ input, missing }) => {
		expect(displayMap.getMissingMapAttributes({ ...baseInput, ...input })).toEqual(missing);
	});
});
