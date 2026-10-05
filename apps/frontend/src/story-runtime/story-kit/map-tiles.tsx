import { MERCATOR_MAX_LATITUDE } from '@nao/shared/map';
import { STORY_MAP_TILE_LAYERS } from '@nao/shared/story-map-tiles';
import { storyThemeMode } from '@nao/shared/story-theme';
import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import { latLngBounds } from '../leaflet';
import { useStoryTheme } from './hooks';
import type { StoryMapTileLayer } from '@nao/shared/story-map-tiles';

export type { StoryMapTileLayer as MapTileLayer };

const WORLD = latLngBounds([-MERCATOR_MAX_LATITUDE, -180], [MERCATOR_MAX_LATITUDE, 180]);
const TILE_SIZE = 256;

/** The themed basemap for a react-leaflet `MapContainer`, showing exactly one world whatever the container size. */
export function MapTiles() {
	const tiles = useMapTiles();
	useSingleWorld();
	return <TileLayer {...tiles} noWrap />;
}

export function useMapTiles(): StoryMapTileLayer {
	const theme = useStoryTheme();
	return STORY_MAP_TILE_LAYERS[theme ? storyThemeMode(theme) : 'light'];
}

function useSingleWorld(): void {
	const map = useMap();
	useEffect(() => {
		map.options.maxBoundsViscosity = 1;
		map.setMaxBounds(WORLD);
		const container = map.getContainer();
		const fitWorld = (): void => {
			const { clientWidth, clientHeight } = container;
			if (clientWidth > 0 && clientHeight > 0) {
				map.setMinZoom(Math.log2(Math.max(clientWidth, clientHeight) / TILE_SIZE));
			}
		};
		const observer = new ResizeObserver(() => {
			fitWorld();
			map.invalidateSize({ animate: false });
		});
		observer.observe(container);
		fitWorld();
		return () => {
			observer.disconnect();
		};
	}, [map]);
}
