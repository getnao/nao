import '../src/env';

import { describe, expect, it } from 'vitest';

import { buildStoryToolDescription } from '../src/agents/tools/story';

describe('buildStoryToolDescription maps', () => {
	it('lists the columns each map_type requires', () => {
		const description = buildStoryToolDescription({ mapsEnabled: true });

		expect(description).toContain('map_type="points" needs latitude_key and longitude_key');
		expect(description).toContain('"scatter_bubble" also needs size_key');
		expect(description).toContain(
			'"choropleth" needs value_key plus region_key with region_boundaries or boundaries_url, or geometry_key',
		);
	});

	it('leaves maps out when they are disabled', () => {
		expect(buildStoryToolDescription({ mapsEnabled: false })).not.toContain('<map');
	});
});
