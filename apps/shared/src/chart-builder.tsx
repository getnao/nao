import React from 'react';
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Customized,
	Pie,
	PieChart,
	PolarAngleAxis,
	PolarGrid,
	PolarRadiusAxis,
	Radar,
	RadarChart,
	Rectangle,
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
} from 'recharts';

import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };

const STACK_SEPARATOR_WIDTH = 2;
/**
 * Thin separator drawn between stacked segments. Using the chart background color makes the
 * outer edges blend into the background while the boundary between two segments reads as a gap,
 * so it stays theme-correct (white in light, dark surface in dark mode). The `var()` resolves
 * in the browser; the concrete fallback covers the backend PNG/HTML export where the backend
 * passes an explicit `backgroundColor` and CSS vars do not resolve.
 */
const DEFAULT_BACKGROUND_COLOR = 'var(--background, #ffffff)';

export function labelize(key: unknown, dateFormat?: DateFormatSettings | null): string {
	const str = String(key);
	if (isIsoDateLike(str)) {
		return formatDateValue(str, dateFormat);
	}
	return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCompactNumber(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
	}
	if (abs >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	}
	if (abs >= 10_000) {
		return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
	}
	return value.toLocaleString();
}

export function formatYAxisTick(value: number): string {
	return formatCompactNumber(value);
}

/** Formats a 0–1 stack ratio (from Recharts `stackOffset="expand"`) as a whole-number percentage. */
export function formatPercentAxisTick(value: number): string {
	return `${Math.round(value * 100)}%`;
}

/**
 * Denominator for 100% stacked shares: the sum of the stacked (non-total) series values.
 * Already-aggregated total series are excluded so the parts sum to exactly 100%.
 */
export function sumPercentStackBase(entries: { value: number; isTotal?: boolean }[]): number {
	return entries.reduce((sum, entry) => (entry.isTotal ? sum : sum + entry.value), 0);
}

/** Formats a single value as its share of `total`, e.g. `42.5%`. Used for 100% stacked tooltips. */
export function formatPercentShare(value: number, total: number): string {
	if (!total) {
		return '0%';
	}
	const share = (value / total) * 100;
	const rounded = Math.round(share * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export function defaultColorFor(_key: string, index: number): string {
	return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export interface BuildChartProps {
	data: Record<string, unknown>[];
	chartType: displayChart.ChartType;
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	series: displayChart.SeriesConfig[];
	colorFor?: (key: string, index: number) => string;
	labelFormatter?: (value: string) => string;
	showGrid?: boolean;
	children?: React.ReactNode[];
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	title?: string;
	maxXAxisTicks?: number;
	/** Chart background color, used as the separator between stacked segments. Pass a concrete color on surfaces where CSS vars do not resolve (backend PNG/HTML export). */
	backgroundColor?: string;
}

/**
 * Builds a Recharts element tree from a display_chart tool config.
 *
 * Used by both the frontend (wrapped in ChartContainer + tooltips) and the
 * backend (rendered to SVG via renderToStaticMarkup for image generation).
 */
export function buildChart(props: BuildChartProps) {
	const resolved = buildResolved(props);

	if (resolved.chartType === 'kpi_card') {
		return buildKpiCard(resolved);
	}
	if (resolved.chartType === 'pie') {
		return buildPieChart(resolved);
	}
	if (
		resolved.chartType === 'line' ||
		resolved.chartType === 'area' ||
		resolved.chartType === 'stacked_area' ||
		resolved.chartType === 'stacked_area_100'
	) {
		return buildAreaChart(resolved);
	}
	if (resolved.chartType === 'scatter') {
		return buildScatterChart(resolved);
	}
	if (resolved.chartType === 'radar') {
		return buildRadarChart(resolved);
	}
	return buildBarChart(resolved);
}

function buildResolved(props: BuildChartProps) {
	const colorFor = props.colorFor ?? defaultColorFor;
	const labelFormatter = props.labelFormatter ?? ((v: string) => labelize(v));

	const titleChild = props.title ? (
		<Customized
			key='chart-title'
			component={({ width = 0 }: { width?: number }) => (
				<text
					x={width / 2}
					y={16}
					textAnchor='middle'
					dominantBaseline='middle'
					fontSize={14}
					fontWeight='600'
					fontFamily='system-ui, sans-serif'
					fill='var(--foreground, #111827)'
				>
					{props.title}
				</text>
			)}
		/>
	) : null;

	const xAxisInterval =
		props.maxXAxisTicks && props.data.length > props.maxXAxisTicks
			? Math.ceil(props.data.length / props.maxXAxisTicks) - 1
			: undefined;

	const isPercent = displayChart.isPercentStackedChartType(props.chartType);
	// A total series is meaningless in a 100% stack (it would be its own 100%), so drop it
	// from both rendering and normalization to keep the drawn bars and tooltip shares in sync.
	const series = isPercent ? percentStackSeries(props.series) : props.series;
	const data = isPercent ? clampNegativeSeriesValues(props.data, series) : props.data;

	const resolved: ResolvedProps = {
		...props,
		series,
		data,
		colorFor,
		labelFormatter,
		xAxisInterval,
		margin: props.title ? { ...props.margin, top: (props.margin?.top ?? 0) + 30 } : props.margin,
		children: titleChild ? [titleChild, ...(props.children ?? [])] : props.children,
	};
	return resolved;
}

/** Series that participate in a 100% stack — already-aggregated total series are excluded. */
export function percentStackSeries(series: displayChart.SeriesConfig[]): displayChart.SeriesConfig[] {
	return series.filter((s) => !s.is_total);
}

/**
 * Recharts `stackOffset="expand"` can produce ratios outside 0–1 when a stack mixes
 * positive and negative values, which breaks the fixed 0–100% axis. 100% stacked charts
 * describe part-of-whole compositions, so we treat negative shares as 0 rather than
 * attempting a signed normalization. Only the series `data_key`s are clamped, so a
 * numeric x-axis or other non-series column is never modified.
 */
export function clampNegativeSeriesValues(
	data: Record<string, unknown>[],
	series: displayChart.SeriesConfig[],
): Record<string, unknown>[] {
	const keys = series.map((s) => s.data_key);
	const hasNegative = data.some((row) =>
		keys.some((key) => typeof row[key] === 'number' && (row[key] as number) < 0),
	);
	if (!hasNegative) {
		return data;
	}
	return data.map((row) => {
		const next = { ...row };
		for (const key of keys) {
			if (typeof next[key] === 'number' && (next[key] as number) < 0) {
				next[key] = 0;
			}
		}
		return next;
	});
}

type ResolvedProps = BuildChartProps &
	Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter'>> & { xAxisInterval?: number };

function buildKpiCard(props: ResolvedProps) {
	const { data, series } = props;

	const kpis = series.map((s) => {
		const value = data[0]?.[s.data_key];
		return { value, displayName: s.label ?? s.data_key };
	});

	return (
		<KpiCardContainer>
			{kpis.map((kpi) => (
				<KpiCard value={kpi.value} displayName={kpi.displayName} />
			))}
		</KpiCardContainer>
	);
}

function KpiCardContainer({ children }: { children: React.ReactNode }) {
	return <div className='flex flex-wrap gap-4 w-full justify-start'>{children}</div>;
}

function KpiCard({ value, displayName }: { value: unknown; displayName: string }) {
	let formattedValue = '';

	if (typeof value === 'number') {
		formattedValue = formatCompactNumber(value);
	} else if (typeof value === 'string') {
		formattedValue = value;
	}

	return (
		<div className='min-w-[160px]'>
			<div className='text-lg tracking-wide'>{displayName}</div>
			<div className='text-3xl font-medium'>{formattedValue}</div>
		</div>
	);
}

function buildBarChart(props: ResolvedProps) {
	const {
		data,
		chartType,
		xAxisKey,
		xAxisType,
		series,
		colorFor,
		labelFormatter,
		showGrid,
		children,
		margin,
		xAxisInterval,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const seriesKeys = series.map((s) => s.data_key);
	const separatorColor = props.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

	return (
		<BarChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				domain={isPercent ? [0, 1] : undefined}
				tickFormatter={isPercent ? formatPercentAxisTick : formatYAxisTick}
			/>
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tick={AXIS_TICK}
				tickLine={true}
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				interval={xAxisInterval}
				tickFormatter={labelFormatter}
			/>
			{children}
			{series.map((s, i) => (
				<Bar
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					stackId={isStacked ? 'stack' : undefined}
					radius={isStacked ? undefined : [4, 4, 4, 4]}
					shape={isStacked ? renderStackedBarShape(seriesKeys, s.data_key, separatorColor) : undefined}
					isAnimationActive={false}
				/>
			))}
		</BarChart>
	);
}

/**
 * Whether `currentKey` is the topmost drawn segment of a stacked bar for a given row —
 * i.e. the last series (in stack order) with a non-zero value. Used to round only the
 * visible top of each bar, independent of series order or zero-valued segments.
 */
export function isTopmostStackSegment(row: Record<string, unknown>, seriesKeys: string[], currentKey: string): boolean {
	let topKey: string | null = null;
	for (const key of seriesKeys) {
		const value = row[key];
		if (typeof value === 'number' && value !== 0) {
			topKey = key;
		}
	}
	return topKey === currentKey;
}

type RectangleProps = React.ComponentProps<typeof Rectangle>;

/**
 * Custom `<Bar>` shape that rounds the top corners of only the topmost non-zero segment of
 * each stacked bar, matching the rounded-top convention of non-stacked bars, and strokes each
 * segment in the background color so adjacent segments read as separated by a thin gap.
 * Recharts applies a single radius per `<Bar>` across all rows, so per-datum rounding needs a shape.
 */
function renderStackedBarShape(seriesKeys: string[], currentKey: string, separatorColor: string) {
	return function StackedBarSegment(shapeProps: unknown) {
		const rectProps = shapeProps as RectangleProps & { payload?: Record<string, unknown> };
		const rounded = isTopmostStackSegment(rectProps.payload ?? {}, seriesKeys, currentKey);
		return (
			<Rectangle
				{...rectProps}
				radius={rounded ? [4, 4, 0, 0] : [0, 0, 0, 0]}
				stroke={separatorColor}
				strokeWidth={STACK_SEPARATOR_WIDTH}
			/>
		);
	};
}

function buildAreaChart(props: ResolvedProps) {
	const {
		data,
		chartType,
		xAxisKey,
		xAxisType,
		series,
		colorFor,
		labelFormatter,
		showGrid,
		children,
		margin,
		xAxisInterval,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const separatorColor = props.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

	return (
		<AreaChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			<defs>
				{series.map((s, i) => {
					const color = colorFor(s.data_key, i);
					const gradientId = `grad-${i}`;
					return (
						<linearGradient key={s.data_key} id={gradientId} x1='0' y1='0' x2='0' y2='1'>
							<stop offset='0%' stopColor={color} stopOpacity={0.25} />
							<stop offset='100%' stopColor={color} stopOpacity={0} />
						</linearGradient>
					);
				})}
			</defs>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				domain={isPercent ? [0, 1] : undefined}
				tickFormatter={isPercent ? formatPercentAxisTick : formatYAxisTick}
			/>
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tick={AXIS_TICK}
				tickLine
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				interval={xAxisInterval}
				tickFormatter={labelFormatter}
			/>
			{children}
			{series.map((s, i) => (
				<Area
					key={s.data_key}
					dataKey={s.data_key}
					type='monotone'
					stroke={isStacked ? separatorColor : colorFor(s.data_key, i)}
					strokeWidth={isStacked ? STACK_SEPARATOR_WIDTH : undefined}
					fill={`url(#grad-${i})`}
					stackId={isStacked ? 'stack' : undefined}
					isAnimationActive={false}
				/>
			))}
		</AreaChart>
	);
}

function buildScatterChart(props: ResolvedProps) {
	const { data, xAxisKey, xAxisType, series, colorFor, showGrid, children, margin } = props;

	return (
		<ScatterChart data={data} accessibilityLayer margin={margin}>
			{showGrid && <CartesianGrid strokeDasharray='3 3' />}
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType ?? 'number'}
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
			/>
			<YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={formatYAxisTick} />
			{children}
			{series.map((s, i) => (
				<Scatter
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					isAnimationActive={false}
				/>
			))}
		</ScatterChart>
	);
}

function buildRadarChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, children, margin } = props;

	return (
		<RadarChart data={data} accessibilityLayer margin={margin}>
			<PolarGrid />
			<PolarAngleAxis dataKey={xAxisKey} tick={AXIS_TICK} />
			<PolarRadiusAxis tick={AXIS_TICK} tickFormatter={formatYAxisTick} />
			{children}
			{series.map((s, i) => (
				<Radar
					key={s.data_key}
					dataKey={s.data_key}
					stroke={colorFor(s.data_key, i)}
					fill={colorFor(s.data_key, i)}
					fillOpacity={0.3}
					isAnimationActive={false}
				/>
			))}
		</RadarChart>
	);
}

function buildPieChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, labelFormatter, children, margin } = props;
	const dataKey = series[0].data_key;

	const uniqueValues = [...new Set(data.map((d) => String(d[xAxisKey])))];
	const colorMap = new Map(uniqueValues.map((v, i) => [v, colorFor(v, i)]));

	const dataWithColors = data.map((item) => ({
		...item,
		fill: colorMap.get(String(item[xAxisKey])) ?? DEFAULT_COLORS[0],
	}));

	return (
		<PieChart accessibilityLayer margin={margin}>
			<Pie
				data={dataWithColors}
				dataKey={dataKey}
				nameKey={xAxisKey}
				label={renderPieLabel(labelFormatter)}
				labelLine={false}
				isAnimationActive={false}
			/>
			{children}
		</PieChart>
	);
}

function renderPieLabel(labelFormatter: (v: string) => string) {
	return ({
		x,
		y,
		name,
		value,
		fill,
		textAnchor,
	}: {
		x: number;
		y: number;
		name: string;
		value: number;
		fill: string;
		textAnchor: 'start' | 'middle' | 'end';
	}) => (
		<text x={x} y={y} fill={fill} textAnchor={textAnchor} dominantBaseline='central' fontSize={12}>
			{`${labelFormatter(String(name))}: ${formatCompactNumber(value)}`}
		</text>
	);
}
