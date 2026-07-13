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
	Scatter,
	ScatterChart,
	XAxis,
	YAxis,
} from 'recharts';

import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };

/** Theme-aware background used to draw the thin gaps between pie/donut slices. */
const DEFAULT_BACKGROUND = 'var(--background, #ffffff)';

/** Beyond this many slices, pie/donut charts bucket the smallest into a single "Other" slice. */
const MAX_PIE_SLICES = 10;

const DONUT_INNER_RADIUS = '45%';

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
	if (displayChart.isPieChart(resolved.chartType)) {
		return buildPieChart(resolved);
	}
	if (resolved.chartType === 'line' || resolved.chartType === 'area' || resolved.chartType === 'stacked_area') {
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

	const resolved: ResolvedProps = {
		...props,
		colorFor,
		labelFormatter,
		backgroundColor: props.backgroundColor ?? DEFAULT_BACKGROUND,
		xAxisInterval,
		margin: props.title ? { ...props.margin, top: (props.margin?.top ?? 0) + 30 } : props.margin,
		children: titleChild ? [titleChild, ...(props.children ?? [])] : props.children,
	};
	return resolved;
}

type ResolvedProps = BuildChartProps &
	Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter' | 'backgroundColor'>> & { xAxisInterval?: number };

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
	const isStacked = chartType === 'stacked_bar';

	return (
		<BarChart data={data} accessibilityLayer margin={margin}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={formatYAxisTick} />
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
					radius={isStacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 4, 4]}
					isAnimationActive={false}
				/>
			))}
		</BarChart>
	);
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
	const isStacked = chartType === 'stacked_area';

	return (
		<AreaChart data={data} accessibilityLayer margin={margin}>
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
			<YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={formatYAxisTick} />
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
					stroke={colorFor(s.data_key, i)}
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
	const { data, chartType, xAxisKey, series, colorFor, children, margin, backgroundColor } = props;
	const dataKey = series[0].data_key;

	// Callers are expected to bucket the data (see `bucketPieData`) so the legend
	// and slices share one set; the builder does not re-bucket here.
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
				innerRadius={chartType === 'donut' ? DONUT_INNER_RADIUS : 0}
				label={false}
				labelLine={false}
				stroke={backgroundColor}
				strokeWidth={1}
				isAnimationActive={false}
			/>
			{children}
		</PieChart>
	);
}

const OTHER_CATEGORY = 'Other';

/**
 * Buckets pie/donut rows so at most `maxSlices` categories are shown: keeps the
 * largest slices by value and sums the remainder into a single "Other" slice.
 * Returns the rows unchanged when they already fit. If a real "Other" category
 * is kept, the aggregate is merged into it so there is never a duplicate slice.
 */
export function bucketPieData(
	rows: Record<string, unknown>[],
	categoryKey: string,
	valueKey: string,
	maxSlices = MAX_PIE_SLICES,
): Record<string, unknown>[] {
	if (rows.length <= maxSlices) {
		return rows;
	}

	const sorted = [...rows].sort((a, b) => toNumericValue(b[valueKey]) - toNumericValue(a[valueKey]));
	const top = sorted.slice(0, maxSlices);
	const rest = sorted.slice(maxSlices);
	const otherValue = rest.reduce((sum, row) => sum + toNumericValue(row[valueKey]), 0);

	const existingOtherIndex = top.findIndex((row) => String(row[categoryKey]) === OTHER_CATEGORY);
	if (existingOtherIndex !== -1) {
		const merged = [...top];
		const existing = merged[existingOtherIndex];
		merged[existingOtherIndex] = { ...existing, [valueKey]: toNumericValue(existing[valueKey]) + otherValue };
		return merged;
	}

	return [...top, { [categoryKey]: OTHER_CATEGORY, [valueKey]: otherValue }];
}

function toNumericValue(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
