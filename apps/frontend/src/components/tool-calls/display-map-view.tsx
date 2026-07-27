import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { computeMapBounds, labelize } from '@nao/shared';
import type { MapPoint } from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';
import 'maplibre-gl/dist/maplibre-gl.css';

const MAP_STYLE_LIGHT = import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
const MAP_STYLE_DARK = import.meta.env.VITE_MAP_STYLE_URL_DARK || 'https://tiles.openfreemap.org/styles/dark';
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
	const markerColorRef = useRef('#522bff');
	const styleUrlRef = useRef('');
	const [initFailed, setInitFailed] = useState(false);
	const isDark = useIsDark();
	pointsRef.current = points;
	configRef.current = config;

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const styleUrl = resolveStyleUrl(document.documentElement.classList.contains('dark'));
		styleUrlRef.current = styleUrl;

		let map: maplibregl.Map;
		try {
			map = new maplibregl.Map({
				container: containerRef.current,
				style: styleUrl,
				cooperativeGestures: true,
				attributionControl: { compact: true },
			});
		} catch {
			setInitFailed(true);
			return;
		}
		mapRef.current = map;
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		map.on('style.load', () => {
			markerColorRef.current = resolveCssColor('--primary', '#522bff');
			map.addSource(POINTS_SOURCE_ID, { type: 'geojson', data: toGeoJsonPoints(pointsRef.current) });
			map.addLayer({
				id: POINTS_LAYER_ID,
				type: 'circle',
				source: POINTS_SOURCE_ID,
				paint: {
					'circle-radius': 5,
					'circle-color': markerColorRef.current,
					'circle-opacity': 0.9,
					'circle-stroke-width': 2,
					'circle-stroke-color': resolveCssColor('--background', '#ffffff'),
				},
			});
			fitToPoints(map, pointsRef.current);
		});

		const tooltip = new maplibregl.Popup({
			closeButton: false,
			closeOnClick: false,
			className: 'map-tooltip',
			maxWidth: '280px',
			offset: 12,
		});

		map.on('mousemove', POINTS_LAYER_ID, (event) => {
			const index = event.features?.[0]?.properties?.index;
			const point = typeof index === 'number' ? pointsRef.current[index] : undefined;
			const content = point ? buildTooltipContent(point, configRef.current, markerColorRef.current) : null;
			if (!point || !content) {
				tooltip.remove();
				map.getCanvas().style.cursor = '';
				return;
			}
			map.getCanvas().style.cursor = 'pointer';
			tooltip.setLngLat([point.longitude, point.latitude]).setDOMContent(content).addTo(map);
		});
		map.on('mouseleave', POINTS_LAYER_ID, () => {
			map.getCanvas().style.cursor = '';
			tooltip.remove();
		});

		return () => {
			mapRef.current = null;
			map.remove();
		};
	}, []);

	useEffect(() => {
		const map = mapRef.current;
		const styleUrl = resolveStyleUrl(isDark);
		if (!map || styleUrl === styleUrlRef.current) {
			return;
		}
		styleUrlRef.current = styleUrl;
		map.setStyle(styleUrl);
	}, [isDark]);

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

	return <div ref={containerRef} className='w-full aspect-3/2 rounded-lg overflow-hidden' />;
}

function useIsDark() {
	const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')));
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);

	return isDark;
}

function resolveStyleUrl(isDark: boolean): string {
	return isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
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

function buildTooltipContent(point: MapPoint, config: displayMap.Input, markerColor: string): HTMLElement | null {
	const rows: HTMLElement[] = [];

	if (config.label_key && point.row[config.label_key] != null) {
		const title = document.createElement('div');
		title.className = 'flex items-center gap-2 font-medium text-foreground';
		const dot = document.createElement('span');
		dot.className = 'h-2.5 w-2.5 shrink-0 rounded-[2px]';
		dot.style.backgroundColor = markerColor;
		const text = document.createElement('span');
		text.textContent = String(point.row[config.label_key]);
		title.append(dot, text);
		rows.push(title);
	}

	for (const key of config.tooltip_keys ?? []) {
		if (key === config.label_key || point.row[key] == null) {
			continue;
		}
		const row = document.createElement('div');
		row.className = 'flex items-center justify-between gap-4 leading-none';
		const label = document.createElement('span');
		label.className = 'text-muted-foreground';
		label.textContent = labelize(key);
		const value = document.createElement('span');
		value.className = 'text-foreground font-mono font-medium tabular-nums';
		value.textContent = String(point.row[key]);
		row.append(label, value);
		rows.push(row);
	}

	if (rows.length === 0) {
		return null;
	}

	const container = document.createElement('div');
	container.className =
		'border-border/50 bg-background grid min-w-32 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl font-sans';
	container.append(...rows);
	return container;
}

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
