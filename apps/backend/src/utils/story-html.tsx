import {
	BUBBLE_MAX_RADIUS,
	bubbleLegendValues,
	bucketPieData,
	buildChoroplethEntries,
	buildMapPoints,
	CHOROPLETH_MAX_OPACITY,
	CHOROPLETH_MIN_OPACITY,
	choroplethOpacity,
	choroplethTooltipKeys,
	choroplethValueDomain,
	computeKpiComparison,
	type CustomBoundarySet,
	DEFAULT_COLORS,
	DEFAULT_MARKER_COLOR,
	DEFAULT_MARKER_RADIUS,
	defaultColorFor,
	formatChartValue,
	formatCompactNumber,
	labelize,
	MAP_BOUNDARY_URLS,
	type MapGeometry,
	type MapPoint,
	MAX_MAP_POINTS,
	type NumericDomain,
	numericDomain,
	parseNumericValue,
	pointTooltipKeys,
	resolveBoundary,
	resolveMapConfig,
	scaleBubbleRadius,
	withOpacity,
} from '@nao/shared';
import {
	type DateFormatSettings,
	DEFAULT_DATE_FORMAT_SETTINGS,
	formatDateValue,
	resolveDateFormatPattern,
} from '@nao/shared/date';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import { mapBlockToInput, splitCodeIntoSegments } from '@nao/shared/story-segments';
import { formatCellValue, isNumericColumn } from '@nao/shared/story-table-utils';
import { flattenStoryTabs } from '@nao/shared/story-tabs';
import type { displayChart, displayMap } from '@nao/shared/tools';
import { marked, Renderer } from 'marked';
import React, { createContext, useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderChartToSvg } from '../components/generate-chart';
import { getCachedBoundary, setCachedBoundary } from './map-boundary-cache';
import { parseAndValidateGeoJson, safeFetch } from './safe-fetch';
import type { QueryDataMap, StoryInput } from './story-download';

const MAX_TABLE_ROWS = 10;

const DOC_MAX_WIDTH = 900;
const DOC_HORIZ_PADDING = 24;
const CHART_WIDTH = DOC_MAX_WIDTH - DOC_HORIZ_PADDING * 2;
const CHART_HEIGHT = Math.round((CHART_WIDTH * 9) / 16);

const MAPLIBRE_VERSION = '5.24.0';
const MAPLIBRE_JS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const MAP_STYLE_URL = process.env.NAO_STORY_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
const MAP_HEIGHT = 360;

type InlinedBoundaries = Map<string, { geojson: unknown; joinProps: string[] | null }>;

const DateFormatContext = createContext<DateFormatSettings>({ ...DEFAULT_DATE_FORMAT_SETTINGS });
const InlinedBoundariesContext = createContext<InlinedBoundaries>(new Map());

export async function generateStoryHtml(
	story: StoryInput,
	queryData: QueryDataMap | null,
	dateFormat?: DateFormatSettings | null,
	customBoundaries?: CustomBoundarySet[],
): Promise<string> {
	const resolvedDateFormat = dateFormat ?? { ...DEFAULT_DATE_FORMAT_SETTINGS };
	const flattened = flattenStoryTabs(story.code);
	const segments = splitCodeIntoSegments(flattened);
	const hasMap = segmentsIncludeMap(segments);
	const inlinedBoundaries = await prefetchCustomBoundaries(segments, customBoundaries ?? []);
	const markup = renderToStaticMarkup(
		<DateFormatContext.Provider value={resolvedDateFormat}>
			<InlinedBoundariesContext.Provider value={inlinedBoundaries}>
				<StoryDocument title={story.title} hasMap={hasMap}>
					{segments.map((seg, i) => (
						<StorySegment key={i} segment={seg} queryData={queryData} />
					))}
					<StoryFooter />
				</StoryDocument>
			</InlinedBoundariesContext.Provider>
		</DateFormatContext.Provider>,
	);
	return `<!DOCTYPE html>\n${markup}`;
}

function segmentsIncludeMap(segments: Segment[]): boolean {
	return segments.some((seg) => seg.type === 'map' || (seg.type === 'grid' && segmentsIncludeMap(seg.children)));
}

async function prefetchCustomBoundaries(
	segments: Segment[],
	customBoundaries: CustomBoundarySet[],
): Promise<InlinedBoundaries> {
	const result: InlinedBoundaries = new Map();

	const customKeysNeeded = new Set<string>();
	const boundaryUrlsNeeded = new Set<string>();

	const collect = (segs: Segment[]) => {
		for (const seg of segs) {
			if (seg.type === 'map') {
				if (seg.map.regionBoundaries && customBoundaries.length > 0) {
					customKeysNeeded.add(seg.map.regionBoundaries);
				}
				if (seg.map.boundariesUrl) {
					boundaryUrlsNeeded.add(seg.map.boundariesUrl);
				}
			} else if (seg.type === 'grid') {
				collect(seg.children);
			}
		}
	};
	collect(segments);

	await Promise.all([
		...[...customKeysNeeded].map(async (key) => {
			const resolved = resolveBoundary(key, customBoundaries);
			if (!resolved) {
				return;
			}
			const cached = getCachedBoundary(resolved.url);
			if (cached) {
				result.set(key, { geojson: cached, joinProps: resolved.joinProps });
				return;
			}
			try {
				const text = await safeFetch(resolved.url);
				const { geojson } = parseAndValidateGeoJson(text);
				setCachedBoundary(resolved.url, geojson);
				result.set(key, { geojson, joinProps: resolved.joinProps });
			} catch {
				// silently skip — the map will render without region fills
			}
		}),
		...[...boundaryUrlsNeeded].map(async (url) => {
			const cached = getCachedBoundary(url);
			if (cached) {
				result.set(url, { geojson: cached, joinProps: null });
				return;
			}
			try {
				const text = await safeFetch(url);
				const { geojson } = parseAndValidateGeoJson(text);
				setCachedBoundary(url, geojson);
				result.set(url, { geojson, joinProps: null });
			} catch {
				// silently skip — the map will render without region fills
			}
		}),
	]);

	return result;
}

function StoryDocument({ title, hasMap, children }: { title: string; hasMap: boolean; children: React.ReactNode }) {
	const dateFormat = useContext(DateFormatContext);
	const pattern = resolveDateFormatPattern(dateFormat);
	const tooltipScript = renderTooltipScript(pattern);
	return (
		<html lang='en'>
			<head>
				<meta charSet='utf-8' />
				<meta name='viewport' content='width=device-width,initial-scale=1' />
				<title>{title}</title>
				{hasMap && <link rel='stylesheet' href={MAPLIBRE_CSS_URL} />}
				<style dangerouslySetInnerHTML={{ __html: DOCUMENT_STYLES }} />
			</head>
			<body>
				{children}
				<script dangerouslySetInnerHTML={{ __html: tooltipScript }} />
				{hasMap && <script src={MAPLIBRE_JS_URL} />}
				{hasMap && <script dangerouslySetInnerHTML={{ __html: renderMapScript() }} />}
			</body>
		</html>
	);
}

function StoryFooter() {
	const dateFormat = useContext(DateFormatContext);
	const today = new Date().toISOString().slice(0, 10);
	const date = formatDateValue(today, dateFormat);
	return (
		<footer
			style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af' }}
		>
			Generated on {date}
		</footer>
	);
}

function StorySegment({ segment, queryData }: { segment: Segment; queryData: QueryDataMap | null }) {
	switch (segment.type) {
		case 'markdown':
			return <MarkdownBlock content={segment.content} />;
		case 'chart':
			return <ChartBlock chart={segment.chart} queryData={queryData} />;
		case 'table':
			return <TableBlock table={segment.table} queryData={queryData} />;
		case 'map':
			return <MapBlock map={segment.map} queryData={queryData} />;
		case 'filter':
			return null;
		case 'grid':
			return <GridBlock segment={segment} queryData={queryData} />;
	}
}

const safeRenderer = new Renderer();
safeRenderer.html = () => '';

function MarkdownBlock({ content }: { content: string }) {
	const html = marked.parse(content, { async: false, renderer: safeRenderer }) as string;
	return <div className='nao-md' dangerouslySetInnerHTML={{ __html: html }} />;
}

function GridBlock({
	segment,
	queryData,
}: {
	segment: Extract<Segment, { type: 'grid' }>;
	queryData: QueryDataMap | null;
}) {
	const allKpi =
		segment.children.length > 0 &&
		segment.children.every((child) => child.type === 'chart' && child.chart.chartType === 'kpi_card');
	if (allKpi) {
		return (
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '16px 0' }}>
				{segment.children.map((child, i) => (
					<div key={i} style={{ flex: `${segment.widths?.[i] ?? 1} 1 0%`, minWidth: 160 }}>
						<StorySegment segment={child} queryData={queryData} />
					</div>
				))}
			</div>
		);
	}

	return (
		<>
			{segment.children.map((child, i) => (
				<StorySegment key={i} segment={child} queryData={queryData} />
			))}
		</>
	);
}

function ChartBlock({ chart, queryData }: { chart: ParsedChartBlock; queryData: QueryDataMap | null }) {
	const dateFormat = useContext(DateFormatContext);
	const rows = queryData?.[chart.queryId]?.data as Record<string, unknown>[] | undefined;
	if (!rows?.length) {
		return <Placeholder label={chart.title || 'Chart'} message='Data unavailable' />;
	}

	if (chart.chartType === 'kpi_card') {
		return <KpiCards chart={chart} rows={rows} />;
	}

	const isPie = chart.chartType === 'pie' || chart.chartType === 'donut';
	const valueKey = chart.series[0]?.data_key ?? '';
	const chartRows = isPie ? bucketPieData(rows, chart.xAxisKey, valueKey) : rows;

	try {
		// Pie/donut render their legend to the right, baked into the SVG; other
		// chart types keep the HTML legend rendered below.
		const svg = renderChartToSvg({
			config: toChartConfig(chart),
			data: rows,
			width: CHART_WIDTH,
			height: CHART_HEIGHT,
			margin: { top: 0, right: 0, bottom: 0, left: 0 },
			includeLegend: isPie,
			dateFormat,
		});
		const chartData = JSON.stringify({
			data: chartRows,
			xAxisKey: chart.xAxisKey,
			series: chart.series,
			chartType: chart.chartType,
			yAxisMin: chart.yAxisMin,
			yAxisMax: chart.yAxisMax,
			hideTotal: chart.hideTotal,
		});
		return (
			<div style={{ margin: '16px 0' }}>
				<div
					className='nao-chart'
					style={{ textAlign: 'center', position: 'relative' }}
					data-chart={chartData}
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
				{!isPie && <ChartLegend series={chart.series} />}
			</div>
		);
	} catch {
		return <Placeholder label={chart.title || 'Chart'} message='Could not render chart' />;
	}
}

function ChartLegend({ series }: { series: ParsedChartBlock['series'] }) {
	const dateFormat = useContext(DateFormatContext);
	return (
		<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 12 }}>
			{series.map((s, i) => {
				const color = s.color || defaultColorFor(s.data_key, i);
				return (
					<div
						key={s.data_key}
						style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 12 }}
					>
						<div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: color }} />
						{s.label || labelize(s.data_key, dateFormat)}
					</div>
				);
			})}
		</div>
	);
}

function KpiCards({ chart, rows }: { chart: ParsedChartBlock; rows: Record<string, unknown>[] }) {
	const sortedRows = [...rows].sort((a, b) => {
		const av = a[chart.xAxisKey];
		const bv = b[chart.xAxisKey];
		if (chart.xAxisType === 'date') {
			return new Date(String(av)).getTime() - new Date(String(bv)).getTime();
		}
		return 0;
	});
	const lastRow = sortedRows[sortedRows.length - 1] ?? {};
	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				gap: 16,
				margin: '16px 0',
				width: '100%',
				justifyContent: 'flex-start',
			}}
		>
			{chart.series.map((s) => {
				const raw = lastRow[s.data_key];
				const value = typeof raw === 'number' ? formatChartValue(raw, s.value_format) : String(raw ?? '');
				const label = s.label ?? s.data_key;
				const comparison = computeKpiComparison(sortedRows, chart.xAxisKey, s.data_key, chart.comparisonMode);
				return (
					<div key={s.data_key} style={{ minWidth: 160 }}>
						<div style={{ fontSize: 18, letterSpacing: '0.025em', color: '#1f2937' }}>{label}</div>
						<div
							style={{
								fontSize: 30,
								fontWeight: 500,
								color: '#111827',
								fontVariantNumeric: 'tabular-nums',
							}}
						>
							{value}
						</div>
						{comparison &&
							(() => {
								const showArrow = comparison.colored && comparison.direction !== 'flat';
								const color = showArrow
									? comparison.direction === 'up'
										? '#16a34a'
										: '#dc2626'
									: '#6b7280';
								return (
									<div
										style={{
											marginTop: 6,
											display: 'flex',
											alignItems: 'center',
											gap: 6,
											fontSize: 14,
											color,
											whiteSpace: 'nowrap',
										}}
									>
										{showArrow && (
											<svg
												width='10'
												height='10'
												viewBox='0 0 14 12'
												fill='currentColor'
												stroke='currentColor'
												strokeWidth='1.6'
												strokeLinejoin='round'
												style={{ flexShrink: 0 }}
											>
												<path
													d={
														comparison.direction === 'up'
															? 'M7 2.5 12 10 2 10Z'
															: 'M2 2.5 12 2.5 7 10Z'
													}
												/>
											</svg>
										)}
										<span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
											{comparison.valueText}
										</span>
										<span style={{ fontWeight: 400 }}>vs. {comparison.periodLabel}</span>
									</div>
								);
							})()}
					</div>
				);
			})}
		</div>
	);
}

function TableBlock({ table, queryData }: { table: ParsedTableBlock; queryData: QueryDataMap | null }) {
	const qd = queryData?.[table.queryId];
	if (!qd?.data.length) {
		return <Placeholder label={table.title || 'Table'} message='Data unavailable' />;
	}

	const { columns } = qd;
	const allRows = qd.data as Record<string, unknown>[];
	const truncated = allRows.length > MAX_TABLE_ROWS;
	const rows = truncated ? allRows.slice(0, MAX_TABLE_ROWS) : allRows;
	const numericCols = new Set(columns.filter((c) => isNumericColumn(allRows, c)));

	const thStyle = (col: string): React.CSSProperties => ({
		padding: '8px 12px',
		textAlign: numericCols.has(col) ? 'right' : 'left',
		fontWeight: 500,
		whiteSpace: 'nowrap',
		color: 'rgba(0,0,0,0.5)',
		borderBottom: '1px solid #e5e7eb',
	});

	const tdStyle = (col: string): React.CSSProperties => ({
		padding: '4px 12px',
		textAlign: numericCols.has(col) ? 'right' : 'left',
		fontVariantNumeric: numericCols.has(col) ? 'tabular-nums' : undefined,
		fontFamily: 'source-code-pro,Menlo,Monaco,Consolas,monospace',
		fontSize: 11,
		lineHeight: '20px',
		whiteSpace: 'nowrap',
	});

	const rowCount = truncated
		? `${allRows.length} rows (showing ${MAX_TABLE_ROWS}, +${allRows.length - MAX_TABLE_ROWS} more)`
		: `${allRows.length} rows`;

	return (
		<div style={{ margin: '8px 0' }}>
			{table.title && <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{table.title}</div>}
			<div
				style={{
					overflow: 'auto',
					borderRadius: 8,
					border: '1px solid #e5e7eb',
					background: 'rgba(255,255,255,0.5)',
				}}
			>
				<table style={{ width: '100%', borderCollapse: 'collapse', borderSpacing: 0, fontSize: 12 }}>
					<thead style={{ background: '#fafafa' }}>
						<tr>
							{columns.map((col) => (
								<th key={col} style={thStyle(col)}>
									{col}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, i) => (
							<tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
								{columns.map((col) => (
									<td key={col} style={tdStyle(col)}>
										<CellValue value={row[col]} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div style={{ textAlign: 'right', padding: '4px 8px', fontSize: 14, color: 'rgba(0,0,0,0.5)' }}>
				{rowCount}
			</div>
		</div>
	);
}

function MapBlock({ map, queryData }: { map: ParsedMapBlock; queryData: QueryDataMap | null }) {
	const dateFormat = useContext(DateFormatContext);
	const rows = queryData?.[map.queryId]?.data as Record<string, unknown>[] | undefined;
	if (!rows?.length) {
		return <Placeholder label={map.title || 'Map'} message='Data unavailable' />;
	}

	const config = resolveMapConfig(rows, mapBlockToInput(map));
	if (config.map_type === 'choropleth') {
		return <ChoroplethMapBlock map={map} config={config} rows={rows} dateFormat={dateFormat} />;
	}
	return <PointMapBlock map={map} config={config} rows={rows} dateFormat={dateFormat} />;
}

function PointMapBlock({
	map,
	config,
	rows,
	dateFormat,
}: {
	map: ParsedMapBlock;
	config: displayMap.Input;
	rows: Record<string, unknown>[];
	dateFormat: DateFormatSettings;
}) {
	if (config.latitude_key === config.longitude_key) {
		return <Placeholder label={map.title || 'Map'} message='Could not render map' />;
	}

	const points = buildMapPoints(rows, config).slice(0, MAX_MAP_POINTS);
	if (points.length === 0) {
		return <Placeholder label={map.title || 'Map'} message='No valid coordinates' />;
	}

	const payload = buildPointPayload(points, config, dateFormat);
	const legend =
		config.map_type === 'scatter_bubble' && payload.sizeDomain ? (
			<BubbleLegendOverlay
				color={payload.color}
				domain={payload.sizeDomain}
				maxRadius={config.radius ?? BUBBLE_MAX_RADIUS}
			/>
		) : null;
	return <MapShell title={map.title} payload={payload} legend={legend} />;
}

function ChoroplethMapBlock({
	map,
	config,
	rows,
	dateFormat,
}: {
	map: ParsedMapBlock;
	config: displayMap.Input;
	rows: Record<string, unknown>[];
	dateFormat: DateFormatSettings;
}) {
	const hasBoundary =
		!!config.geometry_key ||
		(!!config.boundaries_url && !!config.region_key) ||
		(!!config.region_boundaries && !!config.region_key);
	if (!config.value_key || !hasBoundary) {
		return <Placeholder label={map.title || 'Map'} message='Could not render map' />;
	}

	const inlinedBoundaries = useContext(InlinedBoundariesContext);
	const payload = buildChoroplethPayload(config, rows, dateFormat, inlinedBoundaries);
	if (payload.regions.length === 0) {
		return <Placeholder label={map.title || 'Map'} message='No regions to shade' />;
	}
	const legend = payload.domain ? <ChoroplethLegendOverlay color={payload.color} domain={payload.domain} /> : null;
	return <MapShell title={map.title} payload={payload} legend={legend} />;
}

function MapShell({
	title,
	payload,
	legend,
}: {
	title?: string;
	payload: PointPayload | ChoroplethPayload;
	legend: React.ReactNode;
}) {
	return (
		<div style={{ margin: '16px 0' }}>
			{title && <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{title}</div>}
			<div style={{ position: 'relative', width: '100%', height: MAP_HEIGHT }}>
				<div
					className='nao-map'
					data-map={JSON.stringify(payload)}
					style={{
						width: '100%',
						height: '100%',
						borderRadius: 8,
						overflow: 'hidden',
						border: '1px solid #e5e7eb',
						background: '#eef1f5',
					}}
				/>
				{legend}
			</div>
		</div>
	);
}

interface PointPayload {
	type: displayMap.MapType;
	color: string;
	radius: number;
	sizeDomain: NumericDomain | null;
	points: { lng: number; lat: number; radius?: number; label?: string; rows?: [string, string][] }[];
}

interface ChoroplethPayload {
	type: 'choropleth';
	color: string;
	domain: NumericDomain | null;
	boundaryUrl: string | null;
	joinProps: string[] | null;
	inlineGeoJson?: unknown;
	regions: {
		value: number;
		region?: string;
		geometry?: MapGeometry;
		label?: string;
		rows?: [string, string][];
		dot?: string;
	}[];
}

function buildPointPayload(points: MapPoint[], config: displayMap.Input, dateFormat: DateFormatSettings): PointPayload {
	const labelKey = config.label_key;
	const isBubble = config.map_type === 'scatter_bubble';
	const tooltipKeys = pointTooltipKeys(config);
	const sizeDomain =
		isBubble && config.size_key
			? numericDomain(points.map((point) => parseNumericValue(point.row[config.size_key ?? ''])))
			: null;
	const maxRadius = config.radius ?? BUBBLE_MAX_RADIUS;
	return {
		type: config.map_type,
		color: config.color?.trim() || DEFAULT_MARKER_COLOR,
		radius: config.radius ?? DEFAULT_MARKER_RADIUS,
		sizeDomain,
		points: points.map((point) => {
			const label =
				labelKey && point.row[labelKey] != null ? formatCellValue(point.row[labelKey], dateFormat) : undefined;
			const rows = tooltipKeys
				.filter((key) => point.row[key] != null)
				.map((key): [string, string] => [
					labelize(key, dateFormat),
					formatCellValue(point.row[key], dateFormat),
				]);
			const radius = isBubble
				? scaleBubbleRadius(parseNumericValue(point.row[config.size_key ?? '']), sizeDomain, maxRadius)
				: undefined;
			return { lng: point.longitude, lat: point.latitude, radius, label, rows: rows.length ? rows : undefined };
		}),
	};
}

function buildChoroplethPayload(
	config: displayMap.Input,
	rows: Record<string, unknown>[],
	dateFormat: DateFormatSettings,
	inlinedBoundaries?: InlinedBoundaries,
): ChoroplethPayload {
	const entries = buildChoroplethEntries(rows, config);
	const labelKey = config.label_key;
	const tooltipKeys = choroplethTooltipKeys(config);
	const regions: ChoroplethPayload['regions'] = [];
	for (const entry of entries) {
		if (entry.value === null || (entry.geometry === null && entry.region === null)) {
			continue;
		}
		const label =
			labelKey && entry.row[labelKey] != null
				? formatCellValue(entry.row[labelKey], dateFormat)
				: (entry.region ?? undefined);
		const tipRows = tooltipKeys
			.filter((key) => entry.row[key] != null)
			.map((key): [string, string] => [labelize(key, dateFormat), formatCellValue(entry.row[key], dateFormat)]);
		regions.push({
			value: entry.value,
			...(entry.geometry && { geometry: entry.geometry }),
			...(entry.region && { region: entry.region }),
			...(label != null && { label: String(label) }),
			...(tipRows.length && { rows: tipRows }),
		});
	}
	const color = config.color?.trim() || DEFAULT_MARKER_COLOR;
	const domain = choroplethValueDomain(entries);
	for (const region of regions) {
		region.dot = withOpacity(color, choroplethOpacity(region.value, domain));
	}
	const regionBoundaries = config.region_boundaries;
	const inlinedByKey = regionBoundaries ? inlinedBoundaries?.get(regionBoundaries) : undefined;
	const inlinedByUrl = config.boundaries_url ? inlinedBoundaries?.get(config.boundaries_url) : undefined;

	let boundaryUrl: string | null = null;
	let joinProps: string[] | null = null;
	let inlineGeoJson: unknown = undefined;

	if (config.geometry_key) {
		// geometry comes from query rows — no boundary URL needed
	} else if (config.boundaries_url) {
		if (inlinedByUrl) {
			inlineGeoJson = inlinedByUrl.geojson;
			joinProps = inlinedByUrl.joinProps;
		} else {
			boundaryUrl = config.boundaries_url;
			joinProps = config.boundaries_join_property ? [config.boundaries_join_property] : null;
		}
	} else if (regionBoundaries) {
		if (inlinedByKey) {
			inlineGeoJson = inlinedByKey.geojson;
			joinProps = inlinedByKey.joinProps;
		} else {
			boundaryUrl = builtinBoundaryUrl(regionBoundaries);
			joinProps = resolveBoundary(regionBoundaries)?.joinProps ?? null;
		}
	}

	return {
		type: 'choropleth',
		color,
		domain,
		boundaryUrl,
		joinProps,
		...(inlineGeoJson !== undefined && { inlineGeoJson }),
		regions,
	};
}

function builtinBoundaryUrl(set: string): string {
	if (set === 'world_countries') {
		return process.env.NAO_STORY_MAP_BOUNDARIES_WORLD_URL || MAP_BOUNDARY_URLS.world_countries;
	}
	if (set === 'france_regions') {
		return process.env.NAO_STORY_MAP_BOUNDARIES_FRANCE_URL || MAP_BOUNDARY_URLS.france_regions;
	}
	return '';
}

function ChoroplethLegendOverlay({ color, domain }: { color: string; domain: NumericDomain }) {
	return (
		<div style={LEGEND_BOX_STYLE}>
			<div
				style={{
					height: 8,
					width: 96,
					borderRadius: 999,
					background: `linear-gradient(to right, ${withOpacity(color, CHOROPLETH_MIN_OPACITY)}, ${color})`,
				}}
			/>
			<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: '#6b7280' }}>
				<span>{formatCompactNumber(domain.min)}</span>
				<span>{formatCompactNumber(domain.max)}</span>
			</div>
		</div>
	);
}

function BubbleLegendOverlay({
	color,
	domain,
	maxRadius,
}: {
	color: string;
	domain: NumericDomain;
	maxRadius: number;
}) {
	const size = maxRadius * 2;
	const values = bubbleLegendValues(domain);
	return (
		<div style={{ ...LEGEND_BOX_STYLE, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
			{values.map((value, index) => {
				const radius = scaleBubbleRadius(value, domain, maxRadius);
				return (
					<div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
						<div style={{ height: size, display: 'flex', alignItems: 'flex-end' }}>
							<span
								style={{
									width: radius * 2,
									height: radius * 2,
									borderRadius: 999,
									background: withOpacity(color, 0.9),
								}}
							/>
						</div>
						<span style={{ color: '#6b7280' }}>{formatCompactNumber(value)}</span>
					</div>
				);
			})}
		</div>
	);
}

const LEGEND_BOX_STYLE: React.CSSProperties = {
	position: 'absolute',
	bottom: 8,
	left: 8,
	background: 'rgba(255,255,255,0.9)',
	border: '1px solid rgba(0,0,0,0.08)',
	borderRadius: 6,
	padding: '6px 8px',
	fontSize: 10,
	fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
	fontVariantNumeric: 'tabular-nums',
};

function CellValue({ value }: { value: unknown }) {
	const dateFormat = useContext(DateFormatContext);
	if (value === null || value === undefined) {
		return <span style={{ fontStyle: 'italic', color: 'rgba(0,0,0,0.3)' }}>NULL</span>;
	}
	return <>{formatCellValue(value, dateFormat)}</>;
}

function Placeholder({ label, message }: { label: string; message: string }) {
	return (
		<div
			style={{
				margin: '16px 0',
				padding: 24,
				border: '1px dashed #d1d5db',
				borderRadius: 8,
				textAlign: 'center',
				color: '#9ca3af',
				fontSize: 13,
			}}
		>
			<div style={{ fontWeight: 500, marginBottom: 4 }}>{label}</div>
			{message}
		</div>
	);
}

function toChartConfig(chart: ParsedChartBlock) {
	return {
		chart_type: chart.chartType as displayChart.ChartType,
		x_axis_key: chart.xAxisKey,
		x_axis_type: chart.xAxisType as displayChart.XAxisType | null,
		x_axis_label: chart.xAxisLabel,
		series: chart.series,
		y_axis_min: chart.yAxisMin,
		y_axis_max: chart.yAxisMax,
		y_axis_label: chart.yAxisLabel,
		y_axis_right_min: chart.yAxisRightMin,
		y_axis_right_max: chart.yAxisRightMax,
		y_axis_right_label: chart.yAxisRightLabel,
		title: chart.title,
		show_data_labels: chart.showDataLabels,
	};
}

const DOCUMENT_STYLES = `
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:rgba(0,0,0,0.85);max-width:900px;margin:0 auto;padding:32px 24px}
h1{font-size:20px;font-weight:700;margin:0 0 24px;color:#111827}
h2{font-size:20px;font-weight:600;margin:32px 0 12px;color:#111827}
h3{font-size:18px;font-weight:600;margin:24px 0 8px;color:#374151}
p{margin:8px 0;font-size:14px}
ul,ol{padding-left:24px;margin:8px 0;font-size:14px}
li{margin:4px 0}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace}
pre{background:#f3f4f6;padding:16px;border-radius:8px;overflow-x:auto;font-size:12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace}
blockquote{border-left:3px solid #d1d5db;padding-left:16px;margin:12px 0;color:#6b7280}
.nao-md table{width:100%;border-collapse:separate;border-spacing:0;margin:8px 0;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.5)}
.nao-md thead{background:#fafafa}
.nao-md th{padding:8px 12px;text-align:left;font-weight:500;white-space:nowrap;color:rgba(0,0,0,0.5);border-bottom:1px solid #e5e7eb}
.nao-md td{padding:4px 12px;font-family:source-code-pro,Menlo,Monaco,Consolas,monospace;font-size:11px;line-height:20px;white-space:nowrap;border-bottom:1px solid rgba(0,0,0,0.05)}
.nao-md tr:last-child td{border-bottom:none}
svg{max-width:100%;height:auto}
img{max-width:100%;height:auto;border-radius:4px;margin:8px 0}
.nao-map{position:relative}
.maplibregl-popup.map-tooltip{pointer-events:none}
.maplibregl-popup.map-tooltip .maplibregl-popup-content{padding:0;background:transparent;box-shadow:none;border-radius:0}
.maplibregl-popup.map-tooltip .maplibregl-popup-tip{display:none}
.nao-map-pop{display:grid;align-items:start;gap:6px;min-width:128px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.15);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.nao-map-pop-title{display:flex;align-items:center;gap:8px;font-weight:500;color:#111827}
.nao-map-pop-dot{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.nao-map-pop-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;line-height:1.25}
.nao-map-pop-name{color:rgba(0,0,0,0.5)}
.nao-map-pop-val{color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:500;font-variant-numeric:tabular-nums;text-align:right}
.nao-tooltip{position:absolute;pointer-events:none;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:10;opacity:0;transition:opacity .15s;min-width:128px;display:grid;gap:6px}
.nao-tooltip.visible{opacity:1}
.nao-tooltip-label{font-weight:500;color:#111827;text-align:left}
.nao-tooltip-rows{display:grid;gap:6px}
.nao-tooltip-row{display:flex;align-items:center;gap:8px;width:100%}
.nao-tooltip-swatch{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.nao-tooltip-name{color:rgba(0,0,0,0.5);flex:1;text-align:left}
.nao-tooltip-value{color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:500;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;margin-left:auto}
.nao-tooltip-total{display:flex;align-items:center;gap:8px;width:100%;border-top:1px solid rgba(0,0,0,0.08);padding-top:6px;margin-top:2px}
.nao-tooltip-total .nao-tooltip-name{font-weight:500}
.nao-tooltip-total .nao-tooltip-value{font-weight:500}
@media print{body{padding:0;max-width:none}.nao-tooltip{display:none}.nao-chart{break-inside:avoid}.nao-map{break-inside:avoid}.maplibregl-ctrl{display:none!important}table{break-inside:avoid}div[style*="display:flex"]{break-inside:avoid}h1,h2,h3{break-after:avoid}svg{max-width:100%!important;height:auto!important}footer{break-inside:avoid}}
`;

function renderTooltipScript(datePattern: string): string {
	// Inside a `<script>` block, an HTML parser will close the script tag on a
	// raw `</script>` regardless of JS string quoting. Escape `<` (and the
	// equally hazardous `--` / `]]>`) so a user-supplied custom pattern can
	// never inject markup.
	const escapedPattern = JSON.stringify(datePattern)
		.replace(/</g, '\\u003C')
		.replace(/>/g, '\\u003E')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
	return TOOLTIP_SCRIPT_TEMPLATE.replace('__DATE_PATTERN__', escapedPattern);
}

function renderMapScript(): string {
	return MAP_INIT_SCRIPT_TEMPLATE.replace('__MAP_STYLE_URL__', JSON.stringify(MAP_STYLE_URL));
}

const TOOLTIP_SCRIPT_TEMPLATE = `
(function(){
	var PIE_COLORS=${JSON.stringify(DEFAULT_COLORS)};
	var DATE_PATTERN=__DATE_PATTERN__;
	var MONTHS_LONG=['January','February','March','April','May','June','July','August','September','October','November','December'];
	var MONTHS_SHORT=MONTHS_LONG.map(function(m){return m.slice(0,3)});
	var WEEKDAYS_LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
	var WEEKDAYS_SHORT=WEEKDAYS_LONG.map(function(w){return w.slice(0,3)});
	var TOKEN_REGEX=/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|\\[([^\\]]*)\\]/g;
	function pad2(n){n=String(n);return n.length<2?'0'+n:n}
	function formatDate(d){
		var y=d.getUTCFullYear(),mi=d.getUTCMonth(),day=d.getUTCDate(),wi=d.getUTCDay();
		return DATE_PATTERN.replace(TOKEN_REGEX,function(token,literal){
			if(literal!==undefined)return literal;
			switch(token){
				case 'YYYY':return String(y).padStart(4,'0');
				case 'YY':return pad2(y%100);
				case 'MMMM':return MONTHS_LONG[mi];
				case 'MMM':return MONTHS_SHORT[mi];
				case 'MM':return pad2(mi+1);
				case 'M':return String(mi+1);
				case 'DD':return pad2(day);
				case 'D':return String(day);
				case 'dddd':return WEEKDAYS_LONG[wi];
				case 'ddd':return WEEKDAYS_SHORT[wi];
				default:return token;
			}
		});
	}
	function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
	function labelize(s){
		var str=String(s);
		if(/^\\d{4}-\\d{2}-\\d{2}/.test(str)){var d=new Date(str);if(!isNaN(d.getTime()))return escHtml(formatDate(d))}
		return escHtml(str.replace(/_/g,' ').replace(/\\b\\w/g,function(c){return c.toUpperCase()}))
	}
	function formatCompact(v){var a=Math.abs(v);if(a>=1e9)return (v/1e9).toFixed(1).replace(/[.]0$/,'')+'B';if(a>=1e6)return (v/1e6).toFixed(1).replace(/[.]0$/,'')+'M';if(a>=1e4)return (v/1e3).toFixed(1).replace(/[.]0$/,'')+'K';return v.toLocaleString('en-US')}
	// Faithful port of d3-format's SI-prefix formatting so exported values match the chart.
	var SI_PREFIXES=['y','z','a','f','p','n','µ','m','','k','M','G','T','P','E','Z','Y'];
	var siPrefixExponent=0;
	function formatDecimalParts(x,p){
		var e=p?x.toExponential(p-1):x.toExponential();
		var i=e.indexOf('e');
		if(i<0)return null;
		var coefficient=e.slice(0,i);
		return [coefficient.length>1?coefficient[0]+coefficient.slice(2):coefficient,+e.slice(i+1)];
	}
	function formatPrefixAuto(x,p){
		var d=formatDecimalParts(x,p);
		if(!d)return x+'';
		var coefficient=d[0],exponent=d[1];
		siPrefixExponent=Math.max(-8,Math.min(8,Math.floor(exponent/3)))*3;
		var i=exponent-siPrefixExponent+1,n=coefficient.length;
		return i===n?coefficient:i>n?coefficient+new Array(i-n+1).join('0'):i>0?coefficient.slice(0,i)+'.'+coefficient.slice(i):'0.'+new Array(1-i).join('0')+formatDecimalParts(x,Math.max(0,p+i-1))[0];
	}
	function formatTrim(s){
		out:for(var n=s.length,i=1,i0=-1,i1;i<n;++i){
			switch(s[i]){
				case '.':i0=i1=i;break;
				case '0':if(i0===0)i0=i;i1=i;break;
				default:if(!+s[i])break out;if(i0>0)i0=0;break;
			}
		}
		return i0>0?s.slice(0,i0)+s.slice(i1+1):s;
	}
	function formatSi(v,precision,trim,compact){
		var p=precision===undefined?6:precision;
		p=Math.max(1,Math.min(21,p));
		var negative=v<0;
		var value=formatPrefixAuto(Math.abs(v),p);
		if(trim)value=formatTrim(value);
		var unit=SI_PREFIXES[8+siPrefixExponent/3];
		if(compact!=='si'){if(unit==='k')unit='K';if(unit==='G')unit='B'}
		return (negative?'-':'')+value+unit;
	}
	function formatD3Common(v,spec,compact){
		var fixed=/^(,)?(?:\\.([0-9]+))?f$/.exec(spec);
		if(fixed){
			var decimals=fixed[2]===undefined?6:Number(fixed[2]);
			return fixed[1]?v.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):v.toFixed(decimals);
		}
		if(spec===',')return v.toLocaleString('en-US');
		var si=/^\\.?([0-9]+)?(~)?s$/.exec(spec);
		if(si)return formatSi(v,si[1]===undefined?undefined:Number(si[1]),si[2]==='~',compact);
		return formatCompact(v);
	}
	function formatSeriesVal(v,fmt){
		if(typeof v!=='number')return String(v!=null?v:'');
		var number=fmt&&fmt.d3_format?formatD3Common(v,fmt.d3_format,fmt.compact):formatCompact(v);
		var prefix=fmt&&fmt.prefix?String(fmt.prefix):'';
		var suffix=fmt&&fmt.suffix?String(fmt.suffix):'';
		if(prefix&&number.charAt(0)==='-')number='-'+prefix+number.slice(1);
		else number=prefix+number;
		return number+suffix;
	}

	document.querySelectorAll('.nao-chart').forEach(function(container){
		var raw=container.getAttribute('data-chart');
		if(!raw)return;
		var cfg;try{cfg=JSON.parse(raw.replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&'))}catch(e){return}

		var pieColorMap=null;
		if(cfg.chartType==='pie'||cfg.chartType==='donut'){
			pieColorMap={};var ci=0;var seen={};
			cfg.data.forEach(function(d){
				var v=String(d[cfg.xAxisKey]!=null?d[cfg.xAxisKey]:'');
				if(!seen[v]){seen[v]=true;pieColorMap[v]=PIE_COLORS[ci%PIE_COLORS.length];ci++}
			});
		}

		var tip=document.createElement('div');
		tip.className='nao-tooltip';
		container.appendChild(tip);

		var svg=container.querySelector('svg');
		if(!svg)return;

		var bars=svg.querySelectorAll('.recharts-bar-rectangle');
		var areas=svg.querySelectorAll('.recharts-active-dot, .recharts-dot');
		var shapes=bars.length?bars:areas;

		if(cfg.chartType==='pie'||cfg.chartType==='donut'){
			var slices=svg.querySelectorAll('.recharts-pie-sector');
			slices.forEach(function(el,i){
				var row=cfg.data[i];
				if(!row)return;
				el.addEventListener('mouseenter',function(e){showTip(e,row)});
				el.addEventListener('mousemove',function(e){moveTip(e)});
				el.addEventListener('mouseleave',function(){hideTip()});
			});
		}else{
			var cellCount=cfg.data.length;
			if(bars.length>0){
				bars.forEach(function(el,i){
					var dataIndex=i%cellCount;
					var row=cfg.data[dataIndex];
					if(!row)return;
					el.addEventListener('mouseenter',function(e){showTip(e,row)});
					el.addEventListener('mousemove',function(e){moveTip(e)});
					el.addEventListener('mouseleave',function(){hideTip()});
				});
			}
			svg.addEventListener('mousemove',function(e){
				if(bars.length>0)return;
				var plotArea=svg.querySelector('.recharts-cartesian-grid')||svg.querySelector('.recharts-area');
				if(!plotArea)return;
				var pRect=plotArea.getBoundingClientRect();
				var relX=(e.clientX-pRect.left)/pRect.width;
				if(relX<0||relX>1){hideTip();return}
				var idx=Math.round(relX*(cellCount-1));
				idx=Math.max(0,Math.min(cellCount-1,idx));
				var row=cfg.data[idx];
				if(row){showTip(e,row);moveTip(e)}
			});
			svg.addEventListener('mouseleave',function(){hideTip()});
		}

		function showTip(e,row){
			var label=row[cfg.xAxisKey];
			var isPie=!!pieColorMap;
			var html='<div class="nao-tooltip-label">'+labelize(label!=null?label:'')+'</div>';
			html+='<div class="nao-tooltip-rows">';
			var isPercent=cfg.chartType==='stacked_bar_100'||cfg.chartType==='stacked_area_100';
			var isDualAxis=(cfg.series||[]).some(function(s){return s.y_axis==='right'});
			var seriesTotal=0;
			cfg.series.forEach(function(s){var sv=row[s.data_key];if(typeof sv==='number'&&!s.is_total)seriesTotal+=sv;});
			function pctShare(v){if(typeof v!=='number'||!seriesTotal)return '0%';var sh=Math.round(v/seriesTotal*1000)/10;return (sh%1===0?sh:sh.toFixed(1))+'%';}
			var numericValues=[];
			var hasTotalSeries=false;
			var firstNonTotalSeries=cfg.series.find(function(s){return !s.is_total})||cfg.series[0];
			cfg.series.forEach(function(s, si){
				// A total series is dropped from 100% stacked rendering, so hide its tooltip row too.
				if(isPercent&&s.is_total)return;
				var color;
				if(isPie){
					color=pieColorMap[String(label!=null?label:'')]||PIE_COLORS[0];
				}else{
					var fb=PIE_COLORS[si % PIE_COLORS.length];
					color=s.color||fb;
					if(!color||String(color).startsWith('var('))color=fb;
				}
				var val=row[s.data_key];
				if(typeof val==='number')numericValues.push(val);
				if(s.is_total)hasTotalSeries=true;
				var rowName=isPie?labelize(label!=null?label:''):labelize(s.label||s.data_key);
				html+='<div class="nao-tooltip-row">'
					+'<span class="nao-tooltip-swatch" style="background:'+escHtml(color)+'"></span>'
					+'<span class="nao-tooltip-name">'+rowName+'</span>'
					+'<span class="nao-tooltip-value">'+escHtml(isPercent?pctShare(val):formatSeriesVal(val,s.value_format))+'</span>'
					+'</div>';
			});
			if(numericValues.length>1 && !isDualAxis && (isPercent || (!hasTotalSeries && !cfg.hideTotal))){
				var total=numericValues.reduce(function(a,b){return a+b},0);
				html+='<div class="nao-tooltip-total">'
					+'<span class="nao-tooltip-name">Total</span>'
					+'<span class="nao-tooltip-value">'+escHtml(isPercent?'100%':formatSeriesVal(total,firstNonTotalSeries&&firstNonTotalSeries.value_format))+'</span>'
					+'</div>';
			}
			html+='</div>';
			tip.innerHTML=html;
			tip.classList.add('visible');
			moveTip(e);
		}

		function moveTip(e){
			var cr=container.getBoundingClientRect();
			var x=e.clientX-cr.left+12;
			var y=e.clientY-cr.top-10;
			if(x+tip.offsetWidth>cr.width)x=e.clientX-cr.left-tip.offsetWidth-12;
			tip.style.left=x+'px';
			tip.style.top=y+'px';
		}

		function hideTip(){tip.classList.remove('visible')}
	});
})();
`;

const MAP_INIT_SCRIPT_TEMPLATE = `
(function(){
	var STYLE_URL=__MAP_STYLE_URL__;
	var MIN_OPACITY=${CHOROPLETH_MIN_OPACITY};
	var MAX_OPACITY=${CHOROPLETH_MAX_OPACITY};
	function fillOpacity(domain){
		if(!domain||domain.min===domain.max)return (MIN_OPACITY+MAX_OPACITY)/2;
		return ['interpolate',['linear'],['coalesce',['get','value'],domain.min],domain.min,MIN_OPACITY,domain.max,MAX_OPACITY];
	}
	var containers=document.querySelectorAll('.nao-map');
	if(!containers.length||typeof maplibregl==='undefined'){window.__naoMapsReady=true;return;}
	var pending=containers.length;
	function done(){pending--;if(pending<=0){window.__naoMapsReady=true;}}
	function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
	function norm(v){return v==null?null:String(v).trim().toLowerCase()||null;}
	function buildPopup(entry,color){
		var parts=[];
		if(entry.label!=null&&entry.label!==''){
			parts.push('<div class="nao-map-pop-title"><span class="nao-map-pop-dot" style="background:'+esc(color)+'"></span>'+esc(entry.label)+'</div>');
		}
		(entry.rows||[]).forEach(function(row){
			parts.push('<div class="nao-map-pop-row"><span class="nao-map-pop-name">'+esc(row[0])+'</span><span class="nao-map-pop-val">'+esc(row[1])+'</span></div>');
		});
		return parts.length?'<div class="nao-map-pop">'+parts.join('')+'</div>':'';
	}
	function extendBounds(bounds,coords){
		if(!Array.isArray(coords))return;
		if(typeof coords[0]==='number'&&typeof coords[1]==='number'){bounds.extend([coords[0],coords[1]]);return;}
		coords.forEach(function(c){extendBounds(bounds,c);});
	}
	function newMap(container){
		return new maplibregl.Map({container:container,style:STYLE_URL,attributionControl:{compact:true},canvasContextAttributes:{preserveDrawingBuffer:true}});
	}
	function clampMinZoom(map,container){var w=container.clientWidth;if(w)map.setMinZoom(Math.max(0,Math.log2(w/512)+0.02));}
	function renderPoints(map,cfg){
		var isBubble=cfg.type==='scatter_bubble';
		var features=cfg.points.map(function(point,i){
			return {type:'Feature',geometry:{type:'Point',coordinates:[point.lng,point.lat]},properties:{index:i,radius:point.radius||cfg.radius}};
		});
		map.addSource('query-points',{type:'geojson',data:{type:'FeatureCollection',features:features}});
		map.addLayer({id:'query-points-circles',type:'circle',source:'query-points',paint:{'circle-radius':isBubble?['get','radius']:cfg.radius,'circle-color':cfg.color,'circle-opacity':0.9,'circle-stroke-width':1,'circle-stroke-color':'#ffffff'}});
		var bounds=new maplibregl.LngLatBounds();
		cfg.points.forEach(function(point){bounds.extend([point.lng,point.lat]);});
		try{map.fitBounds(bounds,{padding:40,maxZoom:14,duration:0});}catch(e){}
		var popup=new maplibregl.Popup({closeButton:false,closeOnClick:false,className:'map-tooltip',offset:12,maxWidth:'280px'});
		map.on('mousemove','query-points-circles',function(e){
			var feature=e.features&&e.features[0];if(!feature)return;
			var point=cfg.points[feature.properties.index];if(!point)return;
			var html=buildPopup(point,cfg.color);
			if(!html){popup.remove();return;}
			map.getCanvas().style.cursor='pointer';
			popup.setLngLat([point.lng,point.lat]).setHTML(html).addTo(map);
		});
		map.on('mouseleave','query-points-circles',function(){map.getCanvas().style.cursor='';popup.remove();});
	}
	function renderChoropleth(map,cfg,boundaries){
		var index=null;
		if(boundaries&&boundaries.features){
			index={};
			boundaries.features.forEach(function(f){
				var props=f.properties||{};
				var keys=cfg.joinProps||Object.keys(props);
				keys.forEach(function(p){var k=norm(props[p]);if(k&&!index[k])index[k]=f.geometry;});
			});
		}
		var features=[];
		cfg.regions.forEach(function(region){
			var geometry=region.geometry||(index&&region.region?index[norm(region.region)]:null);
			if(!geometry)return;
			features.push({type:'Feature',geometry:geometry,properties:{value:region.value,tip:JSON.stringify({label:region.label,rows:region.rows,dot:region.dot})}});
		});
		map.addSource('query-regions',{type:'geojson',data:{type:'FeatureCollection',features:features}});
		map.addLayer({id:'query-regions-fill',type:'fill',source:'query-regions',paint:{'fill-color':cfg.color,'fill-opacity':fillOpacity(cfg.domain)}});
		map.addLayer({id:'query-regions-line',type:'line',source:'query-regions',paint:{'line-color':'#ffffff','line-width':0.75,'line-opacity':0.6}});
		var bounds=new maplibregl.LngLatBounds();
		features.forEach(function(f){extendBounds(bounds,f.geometry.coordinates);});
		try{if(!bounds.isEmpty())map.fitBounds(bounds,{padding:24,maxZoom:12,duration:0});}catch(e){}
		var popup=new maplibregl.Popup({closeButton:false,closeOnClick:false,className:'map-tooltip',offset:12,maxWidth:'280px'});
		map.on('mousemove','query-regions-fill',function(e){
			var feature=e.features&&e.features[0];if(!feature)return;
			var tip;try{tip=JSON.parse(feature.properties.tip);}catch(err){return;}
			var html=buildPopup(tip,tip.dot||cfg.color);
			if(!html){popup.remove();return;}
			map.getCanvas().style.cursor='pointer';
			popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
		});
		map.on('mouseleave','query-regions-fill',function(){map.getCanvas().style.cursor='';popup.remove();});
	}
	containers.forEach(function(container){
		var raw=container.getAttribute('data-map');
		var cfg;try{cfg=JSON.parse(raw);}catch(e){done();return;}
		var map;
		try{map=newMap(container);}catch(e){done();return;}
		map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
		map.on('error',function(){done();});
		map.on('load',function(){
			clampMinZoom(map,container);
		if(cfg.type==='choropleth'){
			var ready=cfg.inlineGeoJson?Promise.resolve(cfg.inlineGeoJson):cfg.boundaryUrl?fetch(cfg.boundaryUrl).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}):Promise.resolve(null);
				ready.then(function(boundaries){renderChoropleth(map,cfg,boundaries);map.once('idle',done);});
			}else{
				renderPoints(map,cfg);
				map.once('idle',done);
			}
		});
	});
	setTimeout(function(){window.__naoMapsReady=true;},12000);
})();
`;
