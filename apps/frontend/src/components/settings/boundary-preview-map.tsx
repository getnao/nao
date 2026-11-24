import { useEffect, useRef } from 'react';
import type { FeatureCollection } from 'geojson';

import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from '@/hooks/use-map-style';
import { maplibregl } from '@/lib/maplibre';

import 'maplibre-gl/dist/maplibre-gl.css';

export default function BoundaryPreviewMap({ geojson }: { geojson: FeatureCollection }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);

	const isDark = document.documentElement.classList.contains('dark');
	const styleUrl = isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const map = new maplibregl.Map({
			container,
			style: styleUrl,
			attributionControl: false,
		});
		mapRef.current = map;

		map.on('load', () => {
			map.addSource('preview', { type: 'geojson', data: geojson });
			map.addLayer({
				id: 'preview-fill',
				type: 'fill',
				source: 'preview',
				paint: { 'fill-color': '#522bff', 'fill-opacity': 0.25 },
			});
			map.addLayer({
				id: 'preview-line',
				type: 'line',
				source: 'preview',
				paint: { 'line-color': '#522bff', 'line-width': 1, 'line-opacity': 0.7 },
			});

			const bounds = new maplibregl.LngLatBounds();
			let hasCoords = false;
			const extendBounds = (coords: unknown) => {
				if (!Array.isArray(coords)) {
					return;
				}
				if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
					bounds.extend([coords[0] as number, coords[1] as number]);
					hasCoords = true;
					return;
				}
				coords.forEach((c) => extendBounds(c));
			};
			for (const feature of geojson.features) {
				if (feature.geometry) {
					extendBounds((feature.geometry as { coordinates?: unknown }).coordinates);
				}
			}
			if (hasCoords && !bounds.isEmpty()) {
				map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
			}
		});

		return () => {
			map.remove();
			mapRef.current = null;
		};
	}, [geojson, styleUrl]);

	return <div ref={containerRef} className='h-48 w-full rounded-md border overflow-hidden' />;
}
