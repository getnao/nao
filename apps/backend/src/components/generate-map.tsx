import {
	BUBBLE_MAX_RADIUS,
	bubbleLegendValues,
	buildChoroplethEntries,
	buildMapPoints,
	CHOROPLETH_MIN_OPACITY,
	choroplethOpacity,
	choroplethValueDomain,
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
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { svgToPng } from '../utils/generate-chart';
import { builtinBoundaryUrl, fetchBoundary, resolveChoroplethBoundary } from '../utils/map-boundary-resolve';
import { renderMapWithBrowser } from '../utils/render-map-browser';
import { type Basemap, buildBasemapTiles } from '../utils/static-map-basemap';
import {
	buildChoroplethSvg,
	buildPointsSvg,
	collectPoints,
	computeFit,
	project,
	VIEW_HEIGHT,
	VIEW_WIDTH,
} from '../utils/static-map-svg';

const WORLD_BACKDROP_KEY = 'world_countries';

export interface RenderMapInput {
	config: displayMap.Input;
	rows: Record<string, unknown>[];
	customBoundaries?: CustomBoundarySet[];
}

/** Renders a `display_map` tool call to a PNG for surfaces that cannot run the interactive map (Slack, Teams, Telegram, WhatsApp). Returns null when there is nothing to draw. */
export async function generateMapImage(input: RenderMapInput): Promise<Buffer | null> {
	const browserImage = await renderMapWithBrowser({
		config: input.config,
		rows: input.rows,
		customBoundaries: input.customBoundaries,
	});
	if (browserImage) {
		return browserImage;
	}
	const svg = await renderMapToSvg(input);
	return svg ? svgToPng(svg, 3) : null;
}

async function renderMapToSvg({ config, rows, customBoundaries = [] }: RenderMapInput): Promise<string | null> {
	const resolved = resolveMapConfig(rows, config);
	if (resolved.map_type === 'choropleth') {
		return renderChoroplethSvg(resolved, rows, customBoundaries);
	}
	return renderPointsSvg(resolved, rows);
}

async function renderChoroplethSvg(
	config: displayMap.Input,
	rows: Record<string, unknown>[],
	customBoundaries: CustomBoundarySet[],
): Promise<string | null> {
	const entries = buildChoroplethEntries(rows, config);
	const domain = choroplethValueDomain(entries);
	const color = config.color?.trim() || DEFAULT_MARKER_COLOR;

	const boundary = await resolveChoroplethBoundary(config, customBoundaries);
	const index = boundary ? indexBoundaries(boundary.geojson, boundary.joinProps ?? undefined) : null;

	const regions: { geometry: MapGeometry; fill: string }[] = [];
	for (const entry of entries) {
		if (entry.value === null) {
			continue;
		}
		const geometry = entry.geometry ?? (index && entry.region ? index.get(entry.region) : undefined);
		if (!geometry) {
			continue;
		}
		regions.push({ geometry, fill: withOpacity(color, choroplethOpacity(entry.value, domain)) });
	}
	if (regions.length === 0) {
		return null;
	}

	const geometries = regions.map((region) => region.geometry);
	const fit = computeFit(collectPoints(geometries));
	const basemap = await buildBasemapTiles(fit);
	const worldBackdrop = basemap ? undefined : boundary?.geojson.features.map((feature) => feature.geometry);
	const svg = buildChoroplethSvg({ regions, backdrop: worldBackdrop });
	if (!svg) {
		return null;
	}

	return renderSvgMarkup({
		basemap,
		backdrop: svg.backdrop,
		title: config.title,
		legend: domain ? <ChoroplethLegend color={color} domain={domain} /> : null,
		children: svg.regions.map((region, index) => (
			<path
				key={index}
				d={region.d}
				fill={region.fill}
				stroke='#ffffff'
				strokeWidth={0.4}
				strokeOpacity={0.6}
				fillRule='evenodd'
			/>
		)),
	});
}

async function renderPointsSvg(config: displayMap.Input, rows: Record<string, unknown>[]): Promise<string | null> {
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

	const fit = computeFit(points.map((point) => project(point.longitude, point.latitude)));
	const basemap = await buildBasemapTiles(fit);
	const worldBackdrop = basemap
		? undefined
		: (await fetchBoundary(builtinBoundaryUrl(WORLD_BACKDROP_KEY)))?.features.map((feature) => feature.geometry);

	const svg = buildPointsSvg({
		points: points.map((point) => ({
			lng: point.longitude,
			lat: point.latitude,
			radius: isBubble
				? scaleBubbleRadius(parseNumericValue(point.row[config.size_key ?? '']), sizeDomain, maxRadius)
				: defaultRadius,
		})),
		backdrop: worldBackdrop,
	});
	if (!svg) {
		return null;
	}

	return renderSvgMarkup({
		basemap,
		backdrop: svg.backdrop,
		title: config.title,
		legend:
			isBubble && sizeDomain ? <BubbleLegend color={color} domain={sizeDomain} maxRadius={maxRadius} /> : null,
		children: svg.circles.map((circle, index) => (
			<circle
				key={index}
				cx={circle.cx}
				cy={circle.cy}
				r={circle.r}
				fill={color}
				fillOpacity={0.9}
				stroke='#ffffff'
				strokeWidth={0.75}
			/>
		)),
	});
}

const TITLE_BAND_HEIGHT = 34;

function renderSvgMarkup(args: {
	basemap?: Basemap | null;
	backdrop: string[];
	title?: string;
	legend: React.ReactNode;
	children: React.ReactNode;
}): string {
	const bandHeight = args.title ? TITLE_BAND_HEIGHT : 0;
	const totalHeight = VIEW_HEIGHT + bandHeight;
	const markup = renderToStaticMarkup(
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={VIEW_WIDTH}
			height={totalHeight}
			viewBox={`0 0 ${VIEW_WIDTH} ${totalHeight}`}
			preserveAspectRatio='xMidYMid meet'
		>
			<rect x={0} y={0} width={VIEW_WIDTH} height={totalHeight} fill='#ffffff' />
			{args.title && <TitleHeader title={args.title} bandHeight={bandHeight} />}
			<svg
				x={0}
				y={bandHeight}
				width={VIEW_WIDTH}
				height={VIEW_HEIGHT}
				viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
			>
				<rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill='#eef1f5' />
				{args.basemap?.tiles.map((tile, index) => (
					<image
						key={`tile-${index}`}
						href={tile.href}
						x={tile.x}
						y={tile.y}
						width={tile.size}
						height={tile.size}
						preserveAspectRatio='none'
					/>
				))}
				{args.backdrop.map((path, index) => (
					<path
						key={`backdrop-${index}`}
						d={path}
						fill='#d8dee8'
						stroke='#eef1f5'
						strokeWidth={0.5}
						fillRule='evenodd'
					/>
				))}
				{args.children}
				{args.legend}
				{args.basemap && <Attribution text={args.basemap.attribution} />}
			</svg>
		</svg>,
	);
	return markup;
}

function TitleHeader({ title, bandHeight }: { title: string; bandHeight: number }) {
	return (
		<text
			x={VIEW_WIDTH / 2}
			y={bandHeight / 2}
			fontSize={15}
			fontWeight={300}
			fontFamily='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
			fill='#0a0a0a'
			textAnchor='middle'
			dominantBaseline='middle'
		>
			{title}
		</text>
	);
}

function ChoroplethLegend({ color, domain }: { color: string; domain: NumericDomain }) {
	const boxWidth = 112;
	const boxHeight = 34;
	const boxX = 12;
	const boxY = VIEW_HEIGHT - 12 - boxHeight;
	return (
		<g fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'>
			<defs>
				<linearGradient id='nao-choropleth-legend' x1='0' y1='0' x2='1' y2='0'>
					<stop offset='0' stopColor={withOpacity(color, CHOROPLETH_MIN_OPACITY)} />
					<stop offset='1' stopColor={color} />
				</linearGradient>
			</defs>
			<rect
				x={boxX}
				y={boxY}
				width={boxWidth}
				height={boxHeight}
				rx={6}
				fill='rgba(255,255,255,0.9)'
				stroke='rgba(0,0,0,0.08)'
			/>
			<rect x={boxX + 8} y={boxY + 8} width={96} height={8} rx={4} fill='url(#nao-choropleth-legend)' />
			<text x={boxX + 8} y={boxY + 28} fontSize={10} fill='#6b7280' textAnchor='start'>
				{formatCompactNumber(domain.min)}
			</text>
			<text x={boxX + 104} y={boxY + 28} fontSize={10} fill='#6b7280' textAnchor='end'>
				{formatCompactNumber(domain.max)}
			</text>
		</g>
	);
}

function BubbleLegend({ color, domain, maxRadius }: { color: string; domain: NumericDomain; maxRadius: number }) {
	const values = bubbleLegendValues(domain);
	const gap = 16;
	const padding = 8;
	const columnWidth = maxRadius * 2;
	const boxWidth = padding * 2 + values.length * columnWidth + (values.length - 1) * gap;
	const boxHeight = maxRadius * 2 + 26;
	const boxX = 12;
	const boxY = VIEW_HEIGHT - 12 - boxHeight;
	const baseline = boxY + padding + maxRadius * 2;
	return (
		<g fontFamily='ui-monospace, SFMono-Regular, Menlo, monospace'>
			<rect
				x={boxX}
				y={boxY}
				width={boxWidth}
				height={boxHeight}
				rx={6}
				fill='rgba(255,255,255,0.9)'
				stroke='rgba(0,0,0,0.08)'
			/>
			{values.map((value, index) => {
				const radius = scaleBubbleRadius(value, domain, maxRadius);
				const centerX = boxX + padding + columnWidth / 2 + index * (columnWidth + gap);
				return (
					<g key={index}>
						<circle cx={centerX} cy={baseline - radius} r={radius} fill={withOpacity(color, 0.9)} />
						<text x={centerX} y={baseline + 14} fontSize={10} fill='#6b7280' textAnchor='middle'>
							{formatCompactNumber(value)}
						</text>
					</g>
				);
			})}
		</g>
	);
}

function Attribution({ text }: { text: string }) {
	const width = text.length * 5 + 10;
	return (
		<g>
			<rect x={VIEW_WIDTH - width} y={VIEW_HEIGHT - 14} width={width} height={14} fill='rgba(255,255,255,0.7)' />
			<text
				x={VIEW_WIDTH - 5}
				y={VIEW_HEIGHT - 4}
				fontSize={9}
				fill='#3a4756'
				textAnchor='end'
				fontFamily='system-ui, sans-serif'
			>
				{text}
			</text>
		</g>
	);
}
