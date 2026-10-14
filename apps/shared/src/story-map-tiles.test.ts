import { describe, expect, it } from 'vitest';

import { isStoryMapTileUrl, STORY_MAP_TILE_LAYERS } from './story-map-tiles';

const tile = (z: number, y: number, x: number) =>
	new URL(
		STORY_MAP_TILE_LAYERS.light.url.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x)),
	);

describe('isStoryMapTileUrl', () => {
	it('accepts the tiles of the story layers', () => {
		expect(isStoryMapTileUrl(tile(3, 2, 4))).toBe(true);
	});

	it('rejects tile-host URLs that could carry other data', () => {
		expect(isStoryMapTileUrl(new URL(`${tile(3, 2, 4).href}?leak=secret`))).toBe(false);
		expect(isStoryMapTileUrl(new URL('https://server.arcgisonline.com/secret/data'))).toBe(false);
		expect(isStoryMapTileUrl(new URL('https://evil.server.arcgisonline.com/ArcGIS/rest/services'))).toBe(false);
	});
});
