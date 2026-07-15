import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { computeMapBounds, labelize } from '@nao/shared';
import type { MapPoint } from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
const POINTS_SOURCE_ID = 'query-points';
const POINTS_LAYER_ID = 'query-points-circles';

interface MapViewProps {
	points: MapPoint[];
	config: displayMap.Input;
}

export default function MapView({ points, config }: MapViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const pointsRef = useRef(points);
	const configRef = useRef(config);
	const [initFailed, setInitFailed] = useState(false);
	pointsRef.current = points;
	configRef.current = config;

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		let map: maplibregl.Map;
		try {
			map = new maplibregl.Map({
				container: containerRef.current,
				style: MAP_STYLE_URL,
				cooperativeGestures: true,
				attributionControl: { compact: true },
			});
		} catch {
			setInitFailed(true);
			return;
		}
		mapRef.current = map;
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		map.on('load', () => {
			map.addSource(POINTS_SOURCE_ID, { type: 'geojson', data: toGeoJsonPoints(pointsRef.current) });
			map.addLayer({
				id: POINTS_LAYER_ID,
				type: 'circle',
				source: POINTS_SOURCE_ID,
				paint: {
					'circle-radius': 5,
					'circle-color': resolveCssColor('--chart-1', '#2f6f8f'),
					'circle-opacity': 0.9,
					'circle-stroke-width': 2,
					'circle-stroke-color': resolveCssColor('--background', '#ffffff'),
				},
			});
			fitToPoints(map, pointsRef.current);
		});

		map.on('click', POINTS_LAYER_ID, (event) => {
			const index = event.features?.[0]?.properties?.index;
			const point = typeof index === 'number' ? pointsRef.current[index] : undefined;
			if (!point) {
				return;
			}
			const content = buildPopupContent(point, configRef.current);
			if (!content) {
				return;
			}
			new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
				.setLngLat([point.longitude, point.latitude])
				.setDOMContent(content)
				.addTo(map);
		});
		map.on('mouseenter', POINTS_LAYER_ID, () => {
			map.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', POINTS_LAYER_ID, () => {
			map.getCanvas().style.cursor = '';
		});

		return () => {
			mapRef.current = null;
			map.remove();
		};
	}, []);

	useEffect(() => {
		const map = mapRef.current;
		const source = map?.getSource(POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
		if (!map || !source) {
			return;
		}
		source.setData(toGeoJsonPoints(points));
		fitToPoints(map, points);
	}, [points]);

	if (initFailed) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Interactive maps are not supported in this browser (WebGL unavailable).
			</div>
		);
	}

	return <div ref={containerRef} className='w-full aspect-3/2 rounded-md border overflow-hidden' />;
}

function toGeoJsonPoints(points: MapPoint[]) {
	return {
		type: 'FeatureCollection' as const,
		features: points.map((point, index) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] },
			properties: { index },
		})),
	};
}

function fitToPoints(map: maplibregl.Map, points: MapPoint[]) {
	const bounds = computeMapBounds(points);
	if (!bounds) {
		return;
	}
	map.fitBounds(
		[
			[bounds.west, bounds.south],
			[bounds.east, bounds.north],
		],
		{ padding: 48, maxZoom: 14, duration: 0 },
	);
}

/** Builds popup DOM with `textContent` only, so untrusted query values can never inject HTML. */
function buildPopupContent(point: MapPoint, config: displayMap.Input): HTMLElement | null {
	const rows: HTMLElement[] = [];

	if (config.label_key && point.row[config.label_key] != null) {
		const title = document.createElement('div');
		title.className = 'text-sm font-medium text-neutral-900';
		title.textContent = String(point.row[config.label_key]);
		rows.push(title);
	}

	for (const key of config.tooltip_keys ?? []) {
		if (key === config.label_key || point.row[key] == null) {
			continue;
		}
		const row = document.createElement('div');
		row.className = 'flex justify-between gap-3 text-xs';
		const label = document.createElement('span');
		label.className = 'text-neutral-500';
		label.textContent = labelize(key);
		const value = document.createElement('span');
		value.className = 'text-neutral-900 font-medium';
		value.textContent = String(point.row[key]);
		row.append(label, value);
		rows.push(row);
	}

	if (rows.length === 0) {
		return null;
	}

	const container = document.createElement('div');
	container.className = 'flex flex-col gap-1 font-sans';
	container.append(...rows);
	return container;
}

/**
 * Resolves a CSS variable to a color MapLibre can parse (oklch tokens are not supported natively).
 * TODO: colors and the basemap style are snapshotted on mount — a light/dark toggle does not
 * restyle the map until remount.
 */
function resolveCssColor(variableName: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
	const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (!value || !context) {
		return fallback;
	}
	context.fillStyle = fallback;
	context.fillStyle = value;
	context.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
