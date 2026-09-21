import { type CustomBoundarySet, MAP_BOUNDARY_URLS, type MapFeatureCollection, resolveBoundary } from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';

import { getCachedBoundary, setCachedBoundary } from './map-boundary-cache';
import { parseAndValidateGeoJson, safeFetch } from './safe-fetch';

export interface ResolvedBoundary {
	geojson: MapFeatureCollection;
	joinProps: string[] | null;
}

/** Resolves the boundary GeoJSON (and join properties) for a choropleth config, or null when geometry is inline or unavailable. */
export async function resolveChoroplethBoundary(
	config: displayMap.Input,
	customBoundaries: CustomBoundarySet[],
): Promise<ResolvedBoundary | null> {
	if (config.geometry_key) {
		return null;
	}
	if (config.boundaries_url) {
		const geojson = await fetchBoundary(config.boundaries_url);
		return geojson
			? { geojson, joinProps: config.boundaries_join_property ? [config.boundaries_join_property] : null }
			: null;
	}
	if (config.region_boundaries) {
		const boundary = resolveBoundary(config.region_boundaries, customBoundaries);
		if (!boundary) {
			return null;
		}
		const isCustom = customBoundaries.some((set) => set.key === config.region_boundaries);
		const url = isCustom ? boundary.url : builtinBoundaryUrl(config.region_boundaries);
		const geojson = await fetchBoundary(url);
		return geojson ? { geojson, joinProps: boundary.joinProps } : null;
	}
	return null;
}

export async function fetchBoundary(url: string): Promise<MapFeatureCollection | null> {
	if (!url) {
		return null;
	}
	const cached = getCachedBoundary(url);
	if (cached) {
		return cached;
	}
	try {
		const text = await safeFetch(url);
		const { geojson } = parseAndValidateGeoJson(text);
		setCachedBoundary(url, geojson);
		return geojson;
	} catch {
		return null;
	}
}

export function builtinBoundaryUrl(set: string): string {
	if (set === 'world_countries') {
		return process.env.NAO_STORY_MAP_BOUNDARIES_WORLD_URL || MAP_BOUNDARY_URLS.world_countries;
	}
	if (set === 'france_regions') {
		return process.env.NAO_STORY_MAP_BOUNDARIES_FRANCE_URL || MAP_BOUNDARY_URLS.france_regions;
	}
	return resolveBoundary(set)?.url ?? '';
}
