import {
	BUBBLE_MAX_RADIUS,
	bubbleLegendValues,
	buildChoroplethEntries,
	buildMapPoints,
	CHOROPLETH_MIN_OPACITY,
	choroplethValueDomain,
	computeMapBounds,
	type CustomBoundarySet,
	DEFAULT_MARKER_COLOR,
	DEFAULT_MARKER_RADIUS,
	formatCompactNumber,
	indexBoundaries,
	type MapGeometry,
	MAX_MAP_POINTS,
	type NumericDomain,
	numericDomain,
	parseNumericValue,
	resolveMapConfig,
	scaleBubbleRadius,
	withOpacity,
} from '@nao/shared';
import type { displayMap } from '@nao/shared/tools';

import { getBrowser } from './headless-browser';
import { logger } from './logger';
import { resolveChoroplethBoundary } from './map-boundary-resolve';
import { VIEW_HEIGHT, VIEW_WIDTH } from './static-map-svg';
import { MAPLIBRE_CSS_URL, MAPLIBRE_JS_URL, renderMapScript } from './story-html';

const TITLE_BAND_HEIGHT = 40;
const MAP_PADDING = 8;
const MAP_CORNER_RADIUS = 12;
const READY_TIMEOUT_MS = 20000;
const SETTLE_MS = 300;

export interface BrowserMapInput {
	config: displayMap.Input;
	rows: Record<string, unknown>[];
	customBoundaries?: CustomBoundarySet[];
}

interface MapPointConfig {
	lng: number;
	lat: number;
	radius: number;
}

/**
 * Renders a `display_map` to a PNG by loading the same MapLibre + Positron vector style the interactive UI uses
 * inside headless Chromium and screenshotting it, so messaging surfaces match the UI download. Returns null when
 * there is nothing to draw or no headless browser is available — callers fall back to the inline-SVG raster pipeline.
 */
export async function renderMapWithBrowser({
	config,
	rows,
	customBoundaries = [],
}: BrowserMapInput): Promise<Buffer | null> {
	if (process.env.NAO_MAP_BROWSER_RENDER === 'false') {
		return null;
	}
	const resolved = resolveMapConfig(rows, config);
	const built =
		resolved.map_type === 'choropleth'
			? await buildChoroplethMap(resolved, rows, customBoundaries)
			: buildPointsMap(resolved, rows);
	if (!built) {
		return null;
	}

	const html = buildMapHtml({ title: config.title, dataMap: built.dataMap, legendHtml: built.legendHtml });
	return captureHtml(html, Boolean(config.title));
}

interface BuiltMap {
	dataMap: DataMap;
	legendHtml: string;
}

function buildPointsMap(config: displayMap.Input, rows: Record<string, unknown>[]): BuiltMap | null {
	const points = buildMapPoints(rows, config).slice(0, MAX_MAP_POINTS);
	if (points.length === 0) {
		return null;
	}

	const isBubble = config.map_type === 'scatter_bubble';
	const color = config.color?.trim() || DEFAULT_MARKER_COLOR;
	const maxRadius = config.radius ?? BUBBLE_MAX_RADIUS;
	const defaultRadius = config.radius ?? DEFAULT_MARKER_RADIUS;
	const sizeDomain =
		isBubble && config.size_key
			? numericDomain(points.map((point) => parseNumericValue(point.row[config.size_key ?? ''])))
			: null;

	const mapPoints: MapPointConfig[] = points.map((point) => ({
		lng: point.longitude,
		lat: point.latitude,
		radius: isBubble
			? scaleBubbleRadius(parseNumericValue(point.row[config.size_key ?? '']), sizeDomain, maxRadius)
			: defaultRadius,
	}));

	const bounds = computeMapBounds(points);

	return {
		dataMap: {
			type: config.map_type,
			color,
			radius: defaultRadius,
			points: mapPoints,
			bounds: bounds
				? [
						[bounds.west, bounds.south],
						[bounds.east, bounds.north],
					]
				: null,
		},
		legendHtml: isBubble && sizeDomain ? bubbleLegendHtml(color, sizeDomain, maxRadius) : '',
	};
}

async function buildChoroplethMap(
	config: displayMap.Input,
	rows: Record<string, unknown>[],
	customBoundaries: CustomBoundarySet[],
): Promise<BuiltMap | null> {
	const entries = buildChoroplethEntries(rows, config);
	const domain = choroplethValueDomain(entries);
	const color = config.color?.trim() || DEFAULT_MARKER_COLOR;

	const boundary = await resolveChoroplethBoundary(config, customBoundaries);
	const index = boundary ? indexBoundaries(boundary.geojson, boundary.joinProps ?? undefined) : null;

	const regions: ChoroplethRegionConfig[] = [];
	for (const entry of entries) {
		if (entry.value === null) {
			continue;
		}
		const geometry = entry.geometry ?? (index && entry.region ? index.get(entry.region) : undefined);
		if (!geometry) {
			continue;
		}
		regions.push({ geometry, value: entry.value });
	}
	if (regions.length === 0) {
		return null;
	}

	return {
		dataMap: {
			type: 'choropleth',
			color,
			regions,
			domain: domain ? { min: domain.min, max: domain.max } : null,
		},
		legendHtml: domain ? choroplethLegendHtml(color, domain) : '',
	};
}

async function captureHtml(html: string, hasTitle: boolean): Promise<Buffer | null> {
	let page: Awaited<ReturnType<Awaited<ReturnType<typeof getBrowser>>['newPage']>> | null = null;
	try {
		const browser = await getBrowser();
		page = await browser.newPage();
		await page.setViewport({
			width: VIEW_WIDTH + MAP_PADDING * 2,
			height: VIEW_HEIGHT + MAP_PADDING * 2 + (hasTitle ? TITLE_BAND_HEIGHT : 0),
			deviceScaleFactor: 2,
		});
		await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
		await page.waitForFunction('window.__naoMapsReady === true', { timeout: READY_TIMEOUT_MS }).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
		const rendered = await page
			.evaluate(() => (window as unknown as { __naoMapsRendered?: number }).__naoMapsRendered ?? 0)
			.catch(() => 0);
		if (rendered < 1) {
			return null;
		}
		const element = await page.$('#nao-map-wrap');
		if (!element) {
			return null;
		}
		const screenshot = await element.screenshot({ type: 'png' });
		return Buffer.from(screenshot);
	} catch (error) {
		logger.warn(`Browser map render failed, falling back to static image: ${String(error)}`, { source: 'system' });
		return null;
	} finally {
		await page?.close().catch(() => {});
	}
}

interface PointsDataMap {
	type: displayMap.MapType;
	color: string;
	radius: number;
	points: MapPointConfig[];
	bounds: [[number, number], [number, number]] | null;
}

interface ChoroplethRegionConfig {
	geometry: MapGeometry;
	value: number;
}

interface ChoroplethDataMap {
	type: 'choropleth';
	color: string;
	regions: ChoroplethRegionConfig[];
	domain: { min: number; max: number } | null;
}

type DataMap = PointsDataMap | ChoroplethDataMap;

function buildMapHtml({
	title,
	dataMap,
	legendHtml,
}: {
	title?: string;
	dataMap: DataMap;
	legendHtml: string;
}): string {
	const dataAttr = escapeAttribute(JSON.stringify(dataMap));
	const titleBar = title ? `<div id="nao-map-title">${escapeHtml(title)}</div>` : '';
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${MAPLIBRE_CSS_URL}" />
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#ffffff}
#nao-map-wrap{width:${VIEW_WIDTH + MAP_PADDING * 2}px;background:#ffffff;padding:${MAP_PADDING}px}
#nao-map-title{height:${TITLE_BAND_HEIGHT}px;display:flex;align-items:center;justify-content:center;background:#ffffff;color:#0a0a0a;font:300 15px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.nao-map{width:${VIEW_WIDTH}px;height:${VIEW_HEIGHT}px;position:relative;overflow:hidden;border-radius:${MAP_CORNER_RADIUS}px}
.nao-map canvas{display:block}
.maplibregl-ctrl-group{display:none!important}
.nao-map-legend{position:absolute;left:8px;bottom:8px;z-index:2;display:flex;align-items:flex-end;gap:8px;background:rgba(255,255,255,0.9);border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:6px 8px;font:10px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#6b7280}
.nao-map-legend-item{display:flex;flex-direction:column;align-items:center;gap:4px}
.nao-map-legend-circle-wrap{display:flex;align-items:flex-end}
.nao-map-legend-circle{display:block;border-radius:9999px}
.nao-map-legend-scale{display:flex;flex-direction:column;gap:4px}
.nao-map-legend-bar{width:96px;height:8px;border-radius:4px}
.nao-map-legend-scale-labels{display:flex;justify-content:space-between}
</style>
</head>
<body>
<div id="nao-map-wrap">
${titleBar}
<div class="nao-map" data-map="${dataAttr}">${legendHtml}</div>
</div>
<script src="${MAPLIBRE_JS_URL}"></script>
<script>${renderMapScript()}</script>
</body>
</html>`;
}

function bubbleLegendHtml(color: string, domain: NumericDomain, maxRadius: number): string {
	const items = bubbleLegendValues(domain)
		.map((value) => {
			const radius = scaleBubbleRadius(value, domain, maxRadius);
			const size = radius * 2;
			const wrapStyle = escapeAttribute(`height:${maxRadius * 2}px`);
			const circleStyle = escapeAttribute(
				`width:${size}px;height:${size}px;background:${withOpacity(color, 0.9)}`,
			);
			return `<div class="nao-map-legend-item"><div class="nao-map-legend-circle-wrap" style="${wrapStyle}"><span class="nao-map-legend-circle" style="${circleStyle}"></span></div><span>${escapeHtml(formatCompactNumber(value))}</span></div>`;
		})
		.join('');
	return `<div class="nao-map-legend">${items}</div>`;
}

function choroplethLegendHtml(color: string, domain: NumericDomain): string {
	const gradient = `linear-gradient(to right, ${withOpacity(color, CHOROPLETH_MIN_OPACITY)}, ${color})`;
	const barStyle = escapeAttribute(`background:${gradient}`);
	return `<div class="nao-map-legend"><div class="nao-map-legend-scale"><span class="nao-map-legend-bar" style="${barStyle}"></span><span class="nao-map-legend-scale-labels"><span>${escapeHtml(formatCompactNumber(domain.min))}</span><span>${escapeHtml(formatCompactNumber(domain.max))}</span></span></div></div>`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
