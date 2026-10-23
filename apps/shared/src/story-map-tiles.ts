import type { StoryThemeMode } from './story-theme';

/** Raster tile servers a story map may draw from; the frame blocks images from any other host. */
export const STORY_MAP_TILE_HOSTS = ['server.arcgisonline.com'] as const;

export interface StoryMapTileLayer {
	url: string;
	attribution: string;
	maxZoom: number;
}

const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_ATTRIBUTION = 'Tiles \u00a9 Esri \u2014 Esri, HERE, Garmin, OpenStreetMap contributors';

export const STORY_MAP_TILE_LAYERS: Record<StoryThemeMode, StoryMapTileLayer> = {
	light: {
		url: `${ESRI_CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
		attribution: ESRI_ATTRIBUTION,
		maxZoom: 16,
	},
	dark: {
		url: `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
		attribution: ESRI_ATTRIBUTION,
		maxZoom: 16,
	},
};

export const storyMapTileCspSources = (): string[] => {
	return STORY_MAP_TILE_HOSTS.map((host) => `https://${host}`);
};

/** Only the tiles of the story layers, so a tile request cannot carry anything else. */
export const isStoryMapTileUrl = (url: URL): boolean => {
	return (
		url.search === '' && Object.values(STORY_MAP_TILE_LAYERS).some((layer) => matchesTileTemplate(url, layer.url))
	);
};

function matchesTileTemplate(url: URL, template: string): boolean {
	const pattern = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[zyx]\}/g, '\\d+');
	return new RegExp(`^${pattern}$`).test(`${url.origin}${url.pathname}`);
}
