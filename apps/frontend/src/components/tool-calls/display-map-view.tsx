import { memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';

import {
	BUBBLE_MAX_RADIUS,
	bubbleLegendValues,
	buildChoroplethEntries,
	CHOROPLETH_MIN_OPACITY,
	choroplethOpacity,
	choroplethOpacityExpression,
	choroplethTooltipKeys,
	choroplethValueDomain,
	computeMapBounds,
	DEFAULT_MARKER_COLOR,
	DEFAULT_MARKER_RADIUS,
	formatCompactNumber,
	indexBoundaries,
	labelize,
	numericDomain,
	parseNumericValue,
	pointTooltipKeys,
	resolveBoundary,
	scaleBubbleRadius,
	withOpacity,
} from '@nao/shared';
import type {
	ChoroplethEntry,
	CustomBoundarySet,
	MapFeatureCollection as FeatureCollection,
	MapGeometry,
	MapPoint,
	NumericDomain,
} from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';
import type { DataDrivenPropertyValueSpecification } from 'maplibre-gl';
import type { Ref } from 'react';

import { getMapStyle, isMapStyleDark, MAP_STYLE_LIGHT, resolveStyleUrl, useMapStyle } from '@/hooks/use-map-style';
import { getActiveProjectId } from '@/lib/active-project';
import { trpc } from '@/main';

import 'maplibre-gl/dist/maplibre-gl.css';

const POINTS_SOURCE_ID = 'query-points';
const POINTS_LAYER_ID = 'query-points-circles';
const REGIONS_SOURCE_ID = 'query-regions';
const REGIONS_FILL_ID = 'query-regions-fill';
const REGIONS_LINE_ID = 'query-regions-line';
const POINT_STROKE_WIDTH = 1;

export interface MapViewHandle {
	captureImage: (type?: string) => Promise<string | null>;
	resize: () => void;
}

interface MapViewProps {
	points: MapPoint[];
	rows: Record<string, unknown>[];
	config: displayMap.Input;
	ref?: Ref<MapViewHandle>;
	/** Boundary sets injected by unauthenticated hosts (e.g. public embeds) instead of the protected project query. */
	customBoundaries?: CustomBoundarySet[];
	boundaryProjectId?: string | null;
}

export default memo(function MapView({
	points,
	config,
	rows,
	ref,
	customBoundaries: injectedBoundaries,
	boundaryProjectId,
}: MapViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);
	const configRef = useRef(config);
	const pointsRef = useRef(points);
	const colorRef = useRef(DEFAULT_MARKER_COLOR);
	const themeRef = useRef<MapSurfaceTheme | undefined>(undefined);
	const styleUrlRef = useRef('');
	const [initFailed, setInitFailed] = useState(false);
	const [color, setColor] = useState(DEFAULT_MARKER_COLOR);
	const [surfaceTheme, setSurfaceTheme] = useState<MapSurfaceTheme>(() => resolveMapSurfaceTheme(null));
	const isDark = useIsDark();
	const [styleId] = useMapStyle();

	const isChoropleth = config.map_type === 'choropleth';
	const isBubble = config.map_type === 'scatter_bubble';

	const { data: fetchedBoundaries = [] } = useQuery({
		...trpc.project.getMapBoundaries.queryOptions(),
		enabled: injectedBoundaries === undefined,
	});
	const customBoundaries = injectedBoundaries ?? fetchedBoundaries;
	const resolvedBoundary = useMemo(() => {
		if (!isChoropleth) {
			return null;
		}
		if (config.boundaries_url) {
			const proxied = `/api/map-boundaries/proxy?url=${encodeURIComponent(config.boundaries_url)}`;
			const joinProps = config.boundaries_join_property ? [config.boundaries_join_property] : undefined;
			return { url: proxied, joinProps };
		}
		if (!config.region_boundaries) {
			return null;
		}
		const key = config.region_boundaries;
		const custom = customBoundaries.find((s) => s.key === key);
		if (custom) {
			const projectId = boundaryProjectId ?? getActiveProjectId();
			const url = projectId ? `/api/map-boundaries/${projectId}/${key}` : custom.url;
			return { url, joinProps: [custom.joinProperty] };
		}
		const builtins = resolveBoundary(key);
		if (builtins) {
			const url =
				key === 'world_countries'
					? import.meta.env.VITE_MAP_BOUNDARIES_WORLD_URL || builtins.url
					: import.meta.env.VITE_MAP_BOUNDARIES_FRANCE_URL || builtins.url;
			return { url, joinProps: builtins.joinProps };
		}
		return null;
	}, [
		isChoropleth,
		config.boundaries_url,
		config.boundaries_join_property,
		config.region_boundaries,
		customBoundaries,
		boundaryProjectId,
	]);
	const boundaries = useBoundaries(resolvedBoundary?.url);
	const choroplethEntries = useMemo(
		() => (isChoropleth ? buildChoroplethEntries(rows, config) : []),
		[isChoropleth, rows, config],
	);
	const choroplethDomain = useMemo(() => choroplethValueDomain(choroplethEntries), [choroplethEntries]);
	const regions = useMemo<FeatureCollection>(
		() =>
			isChoropleth
				? buildRegionFeatures(
						choroplethEntries,
						config,
						boundaries,
						choroplethDomain,
						resolvedBoundary?.joinProps,
					)
				: emptyCollection(),
		[isChoropleth, choroplethEntries, config, boundaries, choroplethDomain, resolvedBoundary],
	);
	const sizeDomain = useMemo(
		() =>
			isBubble ? numericDomain(points.map((point) => parseNumericValue(point.row[config.size_key ?? '']))) : null,
		[isBubble, points, config.size_key],
	);

	const regionsRef = useRef(regions);
	const choroplethDomainRef = useRef(choroplethDomain);
	const sizeDomainRef = useRef(sizeDomain);
	configRef.current = config;
	pointsRef.current = points;
	regionsRef.current = regions;
	choroplethDomainRef.current = choroplethDomain;
	sizeDomainRef.current = sizeDomain;

	useImperativeHandle(
		ref,
		() => ({
			captureImage: async (type = 'image/png') => {
				const map = mapRef.current;
				if (!map) {
					return null;
				}
				const currentConfig = configRef.current;
				const domains = { choropleth: choroplethDomainRef.current, size: sizeDomainRef.current };
				if (styleUrlRef.current === MAP_STYLE_LIGHT) {
					map.redraw();
					return composeLegendUrl(map.getCanvas(), currentConfig, domains, colorRef.current, type);
				}
				return captureLightSnapshot({
					live: map,
					config: currentConfig,
					domains,
					points: pointsRef.current,
					regions: regionsRef.current,
					type,
				});
			},
			resize: () => {
				mapRef.current?.resize();
			},
		}),
		[],
	);

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const styleUrl = resolveStyleUrl(getMapStyle(), document.documentElement.classList.contains('dark'));
		styleUrlRef.current = styleUrl;

		let map: maplibregl.Map;
		try {
			map = new maplibregl.Map({
				container: containerRef.current,
				style: styleUrl,
				cooperativeGestures: true,
				attributionControl: { compact: true },
				canvasContextAttributes: { preserveDrawingBuffer: true },
			});
		} catch {
			setInitFailed(true);
			return;
		}
		mapRef.current = map;
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
		map.on('resize', () => clampMinZoom(map));

		map.on('style.load', () => {
			clampMinZoom(map);
			withMapStyleTheme(() => {
				const resolved = resolveMarkerColor(configRef.current.color, containerRef.current);
				colorRef.current = resolved;
				setColor(resolved);
				if (configRef.current.map_type === 'choropleth') {
					setupRegionLayers(
						map,
						resolved,
						containerRef.current,
						choroplethDomainRef.current,
						regionsRef.current,
					);
					fitToCollection(map, regionsRef.current);
				} else {
					const data = toGeoJsonPoints(pointsRef.current, configRef.current, sizeDomainRef.current);
					setupPointLayers(map, resolved, containerRef.current, configRef.current, data);
					fitToPoints(map, pointsRef.current);
				}
			});
		});

		setupTooltip(map, () => configRef.current, {
			getPoint: (index) => pointsRef.current[index],
			getColor: () => colorRef.current,
			getTheme: () => themeRef.current ?? resolveMapSurfaceTheme(map.getContainer()),
		});

		return () => {
			mapRef.current = null;
			map.remove();
		};
	}, []);

	useEffect(() => {
		const map = mapRef.current;
		const styleUrl = resolveStyleUrl(styleId, isDark);
		if (!map || styleUrl === styleUrlRef.current) {
			return;
		}
		styleUrlRef.current = styleUrl;
		map.setStyle(styleUrl);
	}, [isDark, styleId]);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) {
			return;
		}
		const theme = resolveMapSurfaceTheme(element);
		themeRef.current = theme;
		setSurfaceTheme(theme);
		applyControlTheme(element, theme);
	}, [isDark, styleId]);

	useEffect(() => {
		const map = mapRef.current;
		if (!map) {
			return;
		}
		if (isChoropleth) {
			const source = map.getSource(REGIONS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
			if (!source) {
				return;
			}
			source.setData(regions);
			applyChoroplethPaint(map, choroplethDomain);
			fitToCollection(map, regions);
			return;
		}
		const source = map.getSource(POINTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
		if (!source) {
			return;
		}
		source.setData(toGeoJsonPoints(points, config, sizeDomain));
		fitToPoints(map, points);
	}, [points, regions, isChoropleth, choroplethDomain, sizeDomain, config]);

	const { color: configColor, radius: configRadius } = config;
	useEffect(() => {
		const map = mapRef.current;
		if (!map) {
			return;
		}
		withMapStyleTheme(() => {
			const resolved = resolveMarkerColor(configColor, containerRef.current);
			colorRef.current = resolved;
			setColor(resolved);
			if (isChoropleth && map.getLayer(REGIONS_FILL_ID)) {
				map.setPaintProperty(REGIONS_FILL_ID, 'fill-color', resolved);
				map.setPaintProperty(
					REGIONS_LINE_ID,
					'line-color',
					resolveCssColor('--border', resolved, containerRef.current),
				);
				return;
			}
			if (!isChoropleth && map.getLayer(POINTS_LAYER_ID)) {
				map.setPaintProperty(POINTS_LAYER_ID, 'circle-color', resolved);
				map.setPaintProperty(POINTS_LAYER_ID, 'circle-radius', pointRadiusExpression(config));
				map.setPaintProperty(
					POINTS_LAYER_ID,
					'circle-stroke-color',
					resolveCssColor('--background', '#ffffff', containerRef.current),
				);
			}
		});
	}, [configColor, configRadius, isDark, styleId, isChoropleth, config]);

	if (initFailed) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Interactive maps are not supported in this browser (WebGL unavailable).
			</div>
		);
	}

	return (
		<div className='relative'>
			<div ref={containerRef} className='w-full aspect-3/2 rounded-lg overflow-hidden' />
			{isChoropleth && choroplethDomain && (
				<ChoroplethLegend color={color} domain={choroplethDomain} theme={surfaceTheme} />
			)}
			{isBubble && sizeDomain && (
				<BubbleLegend
					color={color}
					domain={sizeDomain}
					maxRadius={config.radius ?? BUBBLE_MAX_RADIUS}
					theme={surfaceTheme}
				/>
			)}
		</div>
	);
});

function setupPointLayers(
	map: maplibregl.Map,
	color: string,
	element: HTMLElement | null,
	config: displayMap.Input,
	data: FeatureCollection,
) {
	map.addSource(POINTS_SOURCE_ID, { type: 'geojson', data });
	map.addLayer({
		id: POINTS_LAYER_ID,
		type: 'circle',
		source: POINTS_SOURCE_ID,
		paint: {
			'circle-radius': pointRadiusExpression(config),
			'circle-color': color,
			'circle-opacity': 0.9,
			'circle-stroke-width': POINT_STROKE_WIDTH,
			'circle-stroke-color': resolveCssColor('--background', '#ffffff', element),
		},
	});
}

function setupRegionLayers(
	map: maplibregl.Map,
	color: string,
	element: HTMLElement | null,
	domain: NumericDomain | null,
	data: FeatureCollection,
) {
	map.addSource(REGIONS_SOURCE_ID, { type: 'geojson', data });
	map.addLayer({
		id: REGIONS_FILL_ID,
		type: 'fill',
		source: REGIONS_SOURCE_ID,
		paint: {
			'fill-color': color,
			'fill-opacity': choroplethOpacityExpression(domain) as DataDrivenPropertyValueSpecification<number>,
		},
	});
	map.addLayer({
		id: REGIONS_LINE_ID,
		type: 'line',
		source: REGIONS_SOURCE_ID,
		paint: {
			'line-color': resolveCssColor('--border', color, element),
			'line-width': 0.75,
			'line-opacity': 0.6,
		},
	});
}

function applyChoroplethPaint(map: maplibregl.Map, domain: NumericDomain | null) {
	if (!map.getLayer(REGIONS_FILL_ID)) {
		return;
	}
	map.setPaintProperty(REGIONS_FILL_ID, 'fill-opacity', choroplethOpacityExpression(domain));
}

function pointRadiusExpression(config: displayMap.Input): DataDrivenPropertyValueSpecification<number> {
	if (config.map_type === 'scatter_bubble') {
		return ['get', 'radius'];
	}
	return config.radius ?? DEFAULT_MARKER_RADIUS;
}

const boundaryCache = new Map<string, Promise<FeatureCollection | null>>();

function useBoundaries(url: string | undefined): FeatureCollection | null {
	const [boundaries, setBoundaries] = useState<FeatureCollection | null>(null);
	useEffect(() => {
		if (!url) {
			setBoundaries(null);
			return;
		}
		let active = true;
		loadBoundaries(url).then((collection) => {
			if (active) {
				setBoundaries(collection);
			}
		});
		return () => {
			active = false;
		};
	}, [url]);
	return boundaries;
}

function loadBoundaries(url: string): Promise<FeatureCollection | null> {
	let promise = boundaryCache.get(url);
	if (!promise) {
		promise = fetch(url)
			.then((response) => (response.ok ? (response.json() as Promise<FeatureCollection>) : null))
			.catch(() => null);
		boundaryCache.set(url, promise);
	}
	return promise;
}

function buildRegionFeatures(
	entries: ChoroplethEntry[],
	config: displayMap.Input,
	boundaries: FeatureCollection | null,
	domain: NumericDomain | null,
	joinProps?: string[],
): FeatureCollection {
	const features: FeatureCollection['features'] = [];
	if (config.geometry_key) {
		for (const entry of entries) {
			if (entry.geometry && entry.value !== null) {
				features.push(regionFeature(entry.geometry, entry, config, domain));
			}
		}
		return { type: 'FeatureCollection', features };
	}
	if ((config.boundaries_url || config.region_boundaries) && boundaries) {
		const index = indexBoundaries(boundaries, joinProps);
		for (const entry of entries) {
			if (entry.region === null || entry.value === null) {
				continue;
			}
			const geometry = index.get(entry.region);
			if (geometry) {
				features.push(regionFeature(geometry, entry, config, domain));
			}
		}
	}
	return { type: 'FeatureCollection', features };
}

function regionFeature(
	geometry: MapGeometry,
	entry: ChoroplethEntry,
	config: displayMap.Input,
	domain: NumericDomain | null,
) {
	return {
		type: 'Feature' as const,
		geometry,
		properties: { value: entry.value, tip: JSON.stringify(choroplethTooltipModel(entry, config, domain)) },
	};
}

interface TooltipModel {
	label?: string;
	rows: { label: string; value: string }[];
	swatchOpacity?: number;
}

function choroplethTooltipModel(
	entry: ChoroplethEntry,
	config: displayMap.Input,
	domain: NumericDomain | null,
): TooltipModel {
	const rows: { label: string; value: string }[] = [];
	for (const key of choroplethTooltipKeys(config)) {
		if (entry.row[key] == null) {
			continue;
		}
		rows.push({ label: labelize(key), value: String(entry.row[key]) });
	}
	const label = config.label_key ? entry.row[config.label_key] : entry.region;
	return {
		label: label != null ? String(label) : undefined,
		rows,
		swatchOpacity: choroplethOpacity(entry.value, domain),
	};
}

function pointTooltipModel(point: MapPoint, config: displayMap.Input): TooltipModel {
	const rows: { label: string; value: string }[] = [];
	for (const key of pointTooltipKeys(config)) {
		if (point.row[key] == null) {
			continue;
		}
		rows.push({ label: labelize(key), value: String(point.row[key]) });
	}
	const label = config.label_key ? point.row[config.label_key] : undefined;
	return { label: label != null ? String(label) : undefined, rows };
}

function setupTooltip(
	map: maplibregl.Map,
	getConfig: () => displayMap.Input,
	handlers: {
		getPoint: (index: number) => MapPoint | undefined;
		getColor: () => string;
		getTheme: () => MapSurfaceTheme;
	},
) {
	const tooltip = new maplibregl.Popup({
		closeButton: false,
		closeOnClick: false,
		className: 'map-tooltip',
		maxWidth: '280px',
		offset: 12,
	});

	map.on('mousemove', POINTS_LAYER_ID, (event) => {
		const index = event.features?.[0]?.properties?.index;
		const point = typeof index === 'number' ? handlers.getPoint(index) : undefined;
		const model = point ? pointTooltipModel(point, getConfig()) : null;
		const content = model && buildTooltipElement(model, handlers.getColor(), handlers.getTheme());
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

	map.on('mousemove', REGIONS_FILL_ID, (event) => {
		const raw = event.features?.[0]?.properties?.tip;
		const model = typeof raw === 'string' ? (safeParse(raw) as TooltipModel | null) : null;
		const content = model && buildTooltipElement(model, handlers.getColor(), handlers.getTheme());
		if (!content) {
			tooltip.remove();
			map.getCanvas().style.cursor = '';
			return;
		}
		map.getCanvas().style.cursor = 'pointer';
		tooltip.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
	});
	map.on('mouseleave', REGIONS_FILL_ID, () => {
		map.getCanvas().style.cursor = '';
		tooltip.remove();
	});
}

function buildTooltipElement(model: TooltipModel, color: string, theme: MapSurfaceTheme): HTMLElement | null {
	const rows: HTMLElement[] = [];

	if (model.label) {
		const title = document.createElement('div');
		title.className = 'flex items-center gap-2 font-medium';
		title.style.color = theme.foreground;
		const dot = document.createElement('span');
		dot.className = 'h-2.5 w-2.5 shrink-0 rounded-[2px]';
		dot.style.backgroundColor = model.swatchOpacity != null ? withOpacity(color, model.swatchOpacity) : color;
		const text = document.createElement('span');
		text.textContent = model.label;
		title.append(dot, text);
		rows.push(title);
	}

	for (const entry of model.rows) {
		const row = document.createElement('div');
		row.className = 'flex items-start justify-between gap-4 leading-tight';
		const label = document.createElement('span');
		label.style.color = theme.mutedForeground;
		label.textContent = entry.label;
		const value = document.createElement('span');
		value.className = 'font-mono font-medium tabular-nums text-right';
		value.style.color = theme.foreground;
		value.textContent = entry.value;
		row.append(label, value);
		rows.push(row);
	}

	if (rows.length === 0) {
		return null;
	}

	const container = document.createElement('div');
	container.style.borderColor = withOpacity(theme.border, 0.1);
	container.className =
		'grid min-w-32 items-start gap-1.5 rounded-lg border border-[1px] px-2.5 py-1.5 text-xs shadow-xl font-sans';
	container.style.backgroundColor = theme.background;
	container.append(...rows);
	return container;
}

type LegendModel =
	| { kind: 'choropleth'; color: string; domain: NumericDomain }
	| { kind: 'bubble'; color: string; domain: NumericDomain; maxRadius: number };

function legendModel(
	config: displayMap.Input,
	color: string,
	domains: { choropleth: NumericDomain | null; size: NumericDomain | null },
): LegendModel | null {
	if (config.map_type === 'choropleth' && domains.choropleth) {
		return { kind: 'choropleth', color, domain: domains.choropleth };
	}
	if (config.map_type === 'scatter_bubble' && domains.size) {
		return { kind: 'bubble', color, domain: domains.size, maxRadius: config.radius ?? BUBBLE_MAX_RADIUS };
	}
	return null;
}

const LEGEND_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const LEGEND_MARGIN = 8;
const LEGEND_PADDING_X = 8;
const LEGEND_PADDING_Y = 6;
const LEGEND_TEXT_COLOR = '#6b7280';
const LEGEND_TEXT_HEIGHT = 12;

function composeLegendUrl(
	canvas: HTMLCanvasElement,
	config: displayMap.Input,
	domains: { choropleth: NumericDomain | null; size: NumericDomain | null },
	color: string,
	type: string,
): string {
	const legend = legendModel(config, color, domains);
	const composed = legend ? drawLegendOnCanvas(canvas, legend) : null;
	return (composed ?? canvas).toDataURL(type);
}

interface LightSnapshotOptions {
	live: maplibregl.Map;
	config: displayMap.Input;
	domains: { choropleth: NumericDomain | null; size: NumericDomain | null };
	points: MapPoint[];
	regions: FeatureCollection;
	type: string;
}

const LIGHT_SNAPSHOT_TIMEOUT = 8000;

/** Renders the current map view into a throwaway light-themed map so the exported PNG never carries dark tiles. */
function captureLightSnapshot({
	live,
	config,
	domains,
	points,
	regions,
	type,
}: LightSnapshotOptions): Promise<string | null> {
	return new Promise((resolve) => {
		const liveCanvas = live.getCanvas();
		const width = liveCanvas.clientWidth;
		const height = liveCanvas.clientHeight;
		if (!width || !height) {
			resolve(null);
			return;
		}

		const colors = resolveLightMapColors(config);
		const container = document.createElement('div');
		container.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px`;
		document.body.appendChild(container);

		let map: maplibregl.Map;
		try {
			map = new maplibregl.Map({
				container,
				style: MAP_STYLE_LIGHT,
				interactive: false,
				attributionControl: { compact: true },
				canvasContextAttributes: { preserveDrawingBuffer: true },
				center: live.getCenter(),
				zoom: live.getZoom(),
				bearing: live.getBearing(),
				pitch: live.getPitch(),
			});
		} catch {
			container.remove();
			resolve(null);
			return;
		}

		let settled = false;
		const finish = (url: string | null) => {
			if (settled) {
				return;
			}
			settled = true;
			map.remove();
			container.remove();
			resolve(url);
		};

		const timeout = window.setTimeout(() => finish(null), LIGHT_SNAPSHOT_TIMEOUT);
		map.on('error', () => {
			window.clearTimeout(timeout);
			finish(null);
		});
		map.on('style.load', () => {
			if (config.map_type === 'choropleth') {
				setupRegionLayers(map, colors.fill, container, domains.choropleth, regions);
				map.setPaintProperty(REGIONS_LINE_ID, 'line-color', colors.line);
			} else {
				setupPointLayers(map, colors.fill, container, config, toGeoJsonPoints(points, config, domains.size));
				map.setPaintProperty(POINTS_LAYER_ID, 'circle-stroke-color', colors.stroke);
			}
			map.once('idle', () => {
				window.clearTimeout(timeout);
				finish(composeLegendUrl(map.getCanvas(), config, domains, colors.fill, type));
			});
		});
	});
}

function resolveLightMapColors(config: displayMap.Input): { fill: string; stroke: string; line: string } {
	const root = document.documentElement;
	const wasDark = root.classList.contains('dark');
	if (wasDark) {
		root.classList.remove('dark');
	}
	try {
		const fill = resolveMarkerColor(config.color, root);
		return {
			fill,
			stroke: resolveCssColor('--background', '#ffffff', root),
			line: resolveCssColor('--border', fill, root),
		};
	} finally {
		if (wasDark) {
			root.classList.add('dark');
		}
	}
}

function drawLegendOnCanvas(source: HTMLCanvasElement, legend: LegendModel): HTMLCanvasElement | null {
	const canvas = document.createElement('canvas');
	canvas.width = source.width;
	canvas.height = source.height;
	const context = canvas.getContext('2d');
	if (!context) {
		return null;
	}
	context.drawImage(source, 0, 0);
	const scale = source.clientWidth ? source.width / source.clientWidth : window.devicePixelRatio || 1;
	const cssHeight = source.height / scale;
	context.save();
	context.scale(scale, scale);
	context.font = LEGEND_FONT;
	if (legend.kind === 'choropleth') {
		drawChoroplethLegend(context, cssHeight, legend);
	} else {
		drawBubbleLegend(context, cssHeight, legend);
	}
	context.restore();
	return canvas;
}

function drawLegendBox(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
	context.beginPath();
	context.roundRect(x, y, width, height, 6);
	context.fillStyle = 'rgba(255, 255, 255, 0.9)';
	context.fill();
	context.lineWidth = 1;
	context.strokeStyle = 'rgba(0, 0, 0, 0.08)';
	context.stroke();
}

function drawChoroplethLegend(
	context: CanvasRenderingContext2D,
	cssHeight: number,
	legend: Extract<LegendModel, { kind: 'choropleth' }>,
) {
	const barWidth = 96;
	const barHeight = 8;
	const gap = 4;
	const boxWidth = LEGEND_PADDING_X * 2 + barWidth;
	const boxHeight = LEGEND_PADDING_Y * 2 + barHeight + gap + LEGEND_TEXT_HEIGHT;
	const boxX = LEGEND_MARGIN;
	const boxY = cssHeight - LEGEND_MARGIN - boxHeight;
	drawLegendBox(context, boxX, boxY, boxWidth, boxHeight);

	const barX = boxX + LEGEND_PADDING_X;
	const barY = boxY + LEGEND_PADDING_Y;
	const gradient = context.createLinearGradient(barX, 0, barX + barWidth, 0);
	gradient.addColorStop(0, withOpacity(legend.color, CHOROPLETH_MIN_OPACITY));
	gradient.addColorStop(1, legend.color);
	context.beginPath();
	context.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
	context.fillStyle = gradient;
	context.fill();

	const textY = barY + barHeight + gap + LEGEND_TEXT_HEIGHT / 2;
	context.fillStyle = LEGEND_TEXT_COLOR;
	context.textBaseline = 'middle';
	context.textAlign = 'left';
	context.fillText(formatCompactNumber(legend.domain.min), barX, textY);
	context.textAlign = 'right';
	context.fillText(formatCompactNumber(legend.domain.max), barX + barWidth, textY);
}

function drawBubbleLegend(
	context: CanvasRenderingContext2D,
	cssHeight: number,
	legend: Extract<LegendModel, { kind: 'bubble' }>,
) {
	const values = bubbleLegendValues(legend.domain);
	const gap = 8;
	const labelGap = 4;
	const slotHeight = legend.maxRadius * 2;
	const items = values.map((value) => {
		const radius = scaleBubbleRadius(value, legend.domain, legend.maxRadius);
		const text = formatCompactNumber(value);
		return { radius, text, width: Math.max(radius * 2, context.measureText(text).width) };
	});
	const contentWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
	const boxWidth = LEGEND_PADDING_X * 2 + contentWidth;
	const boxHeight = LEGEND_PADDING_Y * 2 + slotHeight + labelGap + LEGEND_TEXT_HEIGHT;
	const boxX = LEGEND_MARGIN;
	const boxY = cssHeight - LEGEND_MARGIN - boxHeight;
	drawLegendBox(context, boxX, boxY, boxWidth, boxHeight);

	const circleBottom = boxY + LEGEND_PADDING_Y + slotHeight;
	const labelY = circleBottom + labelGap + LEGEND_TEXT_HEIGHT / 2;
	let cursorX = boxX + LEGEND_PADDING_X;
	for (const item of items) {
		const centerX = cursorX + item.width / 2;
		context.beginPath();
		context.arc(centerX, circleBottom - item.radius, item.radius, 0, Math.PI * 2);
		context.fillStyle = withOpacity(legend.color, 0.9);
		context.fill();
		context.fillStyle = LEGEND_TEXT_COLOR;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(item.text, centerX, labelY);
		cursorX += item.width + gap;
	}
}

function ChoroplethLegend({ color, domain, theme }: { color: string; domain: NumericDomain; theme: MapSurfaceTheme }) {
	return (
		<div
			className='absolute bottom-2 left-2 rounded-md border border-[1px] px-2 py-1.5 text-[10px] shadow-sm backdrop-blur'
			style={{ borderColor: withOpacity(theme.border, 0.1), backgroundColor: withOpacity(theme.background, 0.9) }}
		>
			<div
				className='h-2 w-24 rounded-full'
				style={{
					background: `linear-gradient(to right, ${withOpacity(color, CHOROPLETH_MIN_OPACITY)}, ${color})`,
				}}
			/>
			<div className='mt-1 flex justify-between font-mono tabular-nums' style={{ color: theme.mutedForeground }}>
				<span>{formatCompactNumber(domain.min)}</span>
				<span>{formatCompactNumber(domain.max)}</span>
			</div>
		</div>
	);
}

function BubbleLegend({
	color,
	domain,
	maxRadius,
	theme,
}: {
	color: string;
	domain: NumericDomain;
	maxRadius: number;
	theme: MapSurfaceTheme;
}) {
	const size = maxRadius * 2;
	const values = bubbleLegendValues(domain);
	return (
		<div
			className='absolute bottom-2 left-2 flex items-end gap-2 rounded-md border border-[1px] px-2 py-1.5 text-[10px] shadow-sm backdrop-blur'
			style={{ borderColor: withOpacity(theme.border, 0.1), backgroundColor: withOpacity(theme.background, 0.9) }}
		>
			{values.map((value, index) => {
				const radius = scaleBubbleRadius(value, domain, maxRadius);
				return (
					<div key={index} className='flex flex-col items-center gap-1'>
						<div style={{ height: size, display: 'flex', alignItems: 'flex-end' }}>
							<span
								className='rounded-full'
								style={{
									width: radius * 2,
									height: radius * 2,
									backgroundColor: withOpacity(color, 0.9),
								}}
							/>
						</div>
						<span className='font-mono tabular-nums' style={{ color: theme.mutedForeground }}>
							{formatCompactNumber(value)}
						</span>
					</div>
				);
			})}
		</div>
	);
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

function clampMinZoom(map: maplibregl.Map) {
	const width = map.getContainer().clientWidth;
	if (!width) {
		return;
	}
	const minZoom = Math.max(0, Math.log2(width / 512) + 0.02);
	if (Math.abs(map.getMinZoom() - minZoom) > 0.001) {
		map.setMinZoom(minZoom);
	}
}

function emptyCollection(): FeatureCollection {
	return { type: 'FeatureCollection', features: [] };
}

function toGeoJsonPoints(
	points: MapPoint[],
	config: displayMap.Input,
	sizeDomain: NumericDomain | null,
): FeatureCollection {
	const isBubble = config.map_type === 'scatter_bubble';
	const maxRadius = config.radius ?? BUBBLE_MAX_RADIUS;
	return {
		type: 'FeatureCollection',
		features: points.map((point, index) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
			properties: {
				index,
				...(isBubble && {
					radius: scaleBubbleRadius(
						parseNumericValue(point.row[config.size_key ?? '']),
						sizeDomain,
						maxRadius,
					),
				}),
			},
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

function fitToCollection(map: maplibregl.Map, collection: FeatureCollection) {
	const bounds = collectionBounds(collection);
	if (!bounds) {
		return;
	}
	map.fitBounds(bounds, { padding: 32, maxZoom: 12, duration: 0 });
}

function collectionBounds(collection: FeatureCollection): [[number, number], [number, number]] | null {
	let west = Infinity;
	let south = Infinity;
	let east = -Infinity;
	let north = -Infinity;
	const visit = (coords: unknown) => {
		if (!Array.isArray(coords)) {
			return;
		}
		if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
			const lng = coords[0];
			const lat = coords[1];
			west = Math.min(west, lng);
			east = Math.max(east, lng);
			south = Math.min(south, lat);
			north = Math.max(north, lat);
			return;
		}
		coords.forEach(visit);
	};
	for (const feature of collection.features) {
		visit((feature.geometry as { coordinates?: unknown }).coordinates);
	}
	return Number.isFinite(west)
		? [
				[west, south],
				[east, north],
			]
		: null;
}

function resolveMarkerColor(markerColor: string | undefined, element?: HTMLElement | null): string {
	return markerColor?.trim() || resolveCssColor('--primary', DEFAULT_MARKER_COLOR, element);
}

interface MapSurfaceTheme {
	background: string;
	foreground: string;
	border: string;
	mutedForeground: string;
	accent: string;
	isDark: boolean;
}

/** Resolves the theme colors of the map surface (tooltips, controls) from the selected map style, not the app theme. */
function resolveMapSurfaceTheme(element: HTMLElement | null): MapSurfaceTheme {
	return withMapStyleTheme(() => ({
		background: resolveCssColor('--background', '#ffffff', element),
		foreground: resolveCssColor('--foreground', '#111827', element),
		border: resolveCssColor('--border', 'rgba(0, 0, 0, 0.1)', element),
		mutedForeground: resolveCssColor('--muted-foreground', '#6b7280', element),
		accent: resolveCssColor('--accent', 'rgba(0, 0, 0, 0.05)', element),
		isDark: isMapStyleDark(getMapStyle(), document.documentElement.classList.contains('dark')),
	}));
}

function applyControlTheme(element: HTMLElement, theme: MapSurfaceTheme) {
	element.style.setProperty('--map-ctrl-bg', theme.background);
	element.style.setProperty('--map-ctrl-fg', theme.foreground);
	element.style.setProperty('--map-ctrl-border', theme.border);
	element.style.setProperty('--map-ctrl-hover', theme.accent);
	element.style.setProperty('--map-ctrl-icon-filter', theme.isDark ? 'invert(1)' : 'none');
}

function withMapStyleTheme<T>(run: () => T): T {
	const root = document.documentElement;
	const wasDark = root.classList.contains('dark');
	const styleIsDark = isMapStyleDark(getMapStyle(), wasDark);
	if (styleIsDark === wasDark) {
		return run();
	}
	root.classList.toggle('dark', styleIsDark);
	try {
		return run();
	} finally {
		root.classList.toggle('dark', wasDark);
	}
}

function resolveCssColor(variableName: string, fallback: string, element?: HTMLElement | null): string {
	const target = element ?? document.documentElement;
	const value = getComputedStyle(target).getPropertyValue(variableName).trim();
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

function safeParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
