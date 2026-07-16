import React from 'react';
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Customized,
	LabelList,
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

import { collectAxisValues, collectStackedAxisValues, resolveYAxisDomain } from './chart-domain';
import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };
const DATA_LABEL_PROPS = {
	fill: 'var(--foreground, #111827)',
	fontSize: 11,
	fontFamily: 'system-ui, sans-serif',
};
const DATA_LABEL_MARGIN_TOP = 24;
const DATA_LABEL_HEADROOM_RATIO = 0.9;
const MAX_LINE_AREA_DATA_LABELS = 12;

/** Theme-aware background used to draw the thin gaps between pie/donut slices. */
const DEFAULT_BACKGROUND = 'var(--background, #ffffff)';

/** Beyond this many slices, pie/donut charts bucket the smallest into a single "Other" slice. */
const MAX_PIE_SLICES = 10;

const DONUT_INNER_RADIUS = '45%';

const STACK_SEPARATOR_WIDTH = 1;
/**
 * Thin separator drawn between stacked segments. Using the chart background color makes the
 * outer edges blend into the background while the boundary between two segments reads as a gap,
 * so it stays theme-correct (white in light, dark surface in dark mode). The `var()` resolves
 * in the browser; the concrete fallback covers the backend PNG/HTML export where the backend
 * passes an explicit `backgroundColor` and CSS vars do not resolve.
 */
const DEFAULT_BACKGROUND_COLOR = 'var(--background, #ffffff)';

/**
 * Reserved width for the Y axis band. Smaller than the Recharts default (60)
 * so the tick labels sit close to the chart's left edge, aligned under the
 * title. Y values are abbreviated by `formatYAxisTick` (e.g. `1.2K`).
 */
const Y_AXIS_WIDTH = 36;

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

/**
 * Formats a Y axis tick so it stays short enough for the narrow axis band
 * ({@link Y_AXIS_WIDTH}px) without losing meaningful precision. Abbreviates by
 * absolute value while preserving the sign (`1020` → `1.02K`, `-1_500_000` →
 * `-1.5M`) with a 2-decimal mantissa so near-boundary ticks stay distinct.
 * Sub-integer magnitudes keep two significant digits (`0.004` → `0.004`) rather
 * than rounding to `0`.
 */
export function formatYAxisTick(value: number): string {
	const abs = Math.abs(value);
	const sign = value < 0 ? '-' : '';
	if (abs >= 1_000_000_000) {
		return `${sign}${abbreviate(abs, 1_000_000_000)}B`;
	}
	if (abs >= 1_000_000) {
		return `${sign}${abbreviate(abs, 1_000_000)}M`;
	}
	if (abs >= 1_000) {
		return `${sign}${abbreviate(abs, 1_000)}K`;
	}
	if (Number.isInteger(value)) {
		return String(value);
	}
	return String(Number(abs < 1 ? value.toPrecision(2) : value.toFixed(2)));
}

function abbreviate(abs: number, unit: number): string {
	return String(Number((abs / unit).toFixed(2)));
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

export function formatDataLabel(value: unknown): string {
	const number = toFiniteNumber(value);
	return number == null ? '' : formatCompactNumber(number);
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
	renderTitle?: boolean;
	maxXAxisTicks?: number;
	yAxisMin?: number;
	yAxisMax?: number;
	/** Chart background color, used as the separator between stacked segments. Pass a concrete color on surfaces where CSS vars do not resolve (backend PNG/HTML export). */
	backgroundColor?: string;
	showDataLabels?: boolean;
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

	const title = props.renderTitle !== false ? props.title : undefined;
	const titleChild = title ? renderChartTitle(title) : null;
	const showTitle = titleChild != null;

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
		backgroundColor: props.backgroundColor ?? DEFAULT_BACKGROUND,
		xAxisInterval,
		margin: buildChartMargin(props, showTitle),
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
	Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter' | 'backgroundColor'>> & { xAxisInterval?: number };

function buildChartMargin(props: BuildChartProps, showTitle: boolean) {
	const titleTop = showTitle ? 30 : 0;
	const labelsTop = shouldReserveDataLabelHeadroom(props) ? DATA_LABEL_MARGIN_TOP : 0;
	if (titleTop === 0 && labelsTop === 0) {
		return props.margin;
	}
	return { ...props.margin, top: (props.margin?.top ?? 0) + titleTop + labelsTop };
}

export function shouldReserveDataLabelHeadroom(props: BuildChartProps): boolean {
	if (props.showDataLabels !== true || !isCartesianLabelChart(props.chartType)) {
		return false;
	}
	const maxValue = getMaxPlottedValue(props);
	if (maxValue == null || maxValue <= 0) {
		return false;
	}
	return maxValue >= niceAxisMax(maxValue) * DATA_LABEL_HEADROOM_RATIO;
}

function isCartesianLabelChart(chartType: displayChart.ChartType): boolean {
	return (
		chartType === 'bar' ||
		chartType === 'stacked_bar' ||
		chartType === 'line' ||
		chartType === 'area' ||
		chartType === 'stacked_area'
	);
}

function getMaxPlottedValue(props: BuildChartProps): number | null {
	const isStacked = props.chartType === 'stacked_bar' || props.chartType === 'stacked_area';
	return isStacked ? getMaxStackTotal(props.data, props.series) : getMaxSeriesValue(props.data, props.series);
}

function getMaxSeriesValue(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]): number | null {
	let max: number | null = null;
	for (const row of data) {
		for (const item of series) {
			const value = toFiniteNumber(row[item.data_key]);
			if (value != null && (max == null || value > max)) {
				max = value;
			}
		}
	}
	return max;
}

function getMaxStackTotal(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]): number | null {
	let max: number | null = null;
	for (const row of data) {
		let positive = 0;
		for (const item of series) {
			if (item.is_total) {
				continue;
			}
			const value = toFiniteNumber(row[item.data_key]);
			if (value != null && value > 0) {
				positive += value;
			}
		}
		if (positive > 0 && (max == null || positive > max)) {
			max = positive;
		}
	}
	return max;
}

export function niceAxisMax(dataMax: number, tickCount = 5): number {
	if (dataMax <= 0) {
		return 0;
	}
	const roughStep = dataMax / (tickCount - 1);
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const normalized = roughStep / magnitude;
	const niceNormalized =
		normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
	const niceStep = niceNormalized * magnitude;
	return niceStep * Math.ceil(dataMax / niceStep);
}

function buildKpiCard(props: ResolvedProps) {
	const { data, series } = props;

	return (
		<KpiCardContainer>
			{series.map((s) => (
				<KpiCard key={s.data_key} value={data[0]?.[s.data_key]} displayName={s.label ?? s.data_key} />
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

function renderValueYAxis(isPercent = false) {
	return (
		<YAxis
			width={Y_AXIS_WIDTH}
			tick={AXIS_TICK}
			tickLine={false}
			axisLine={false}
			minTickGap={12}
			domain={isPercent ? [0, 1] : undefined}
			tickFormatter={isPercent ? formatPercentAxisTick : formatYAxisTick}
		/>
	);
}

function renderCategoryXAxis({
	xAxisKey,
	xAxisType,
	xAxisInterval,
	labelFormatter,
}: {
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	xAxisInterval?: number;
	labelFormatter: (value: string) => string;
}) {
	return (
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
	);
}

function buildBarChart(props: ResolvedProps) {
	const {
		data,
		chartType,
		xAxisKey,
		xAxisType,
		colorFor,
		labelFormatter,
		showGrid,
		children,
		margin,
		xAxisInterval,
		series,
		yAxisMin,
		yAxisMax,
		showDataLabels,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const dataKeys = series.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const { renderedSeries, stackTotalLabel, stackTotalLabelIndex } = getDataLabelSetup(props, isStacked);
	const seriesKeys = renderedSeries.map((s) => s.data_key);
	const separatorColor = props.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

	return (
		<BarChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			{isPercent ? (
				renderValueYAxis(true)
			) : (
				<YAxis
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={formatYAxisTick}
					domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, true)}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
				/>
			)}
			{renderCategoryXAxis({ xAxisKey, xAxisType, xAxisInterval, labelFormatter })}
			{children}
			{renderedSeries.map((s, i) => (
				<Bar
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					stackId={isStacked ? 'stack' : undefined}
					radius={isStacked ? undefined : [4, 4, 4, 4]}
					shape={isStacked ? renderStackedBarShape(seriesKeys, s.data_key, separatorColor) : undefined}
					isAnimationActive={false}
				>
					{showDataLabels && !isStacked && (
						<LabelList position='top' formatter={formatDataLabel} {...DATA_LABEL_PROPS} />
					)}
					{stackTotalLabel && i === stackTotalLabelIndex && <LabelList content={stackTotalLabel} />}
				</Bar>
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
		yAxisMin,
		yAxisMax,
		showDataLabels,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const zeroBaseline = chartType !== 'line';
	const dataKeys = series.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const { renderedSeries, stackTotalLabel, stackTotalLabelIndex } = getDataLabelSetup(props, isStacked);
	const pointLabelContent = showDataLabels && !isStacked ? buildPointLabelContentBySeries(data, series) : new Map();

	return (
		<AreaChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			<defs>
				{renderedSeries.map((s, i) => {
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
			{isPercent ? (
				renderValueYAxis(true)
			) : (
				<YAxis
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={formatYAxisTick}
					domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, zeroBaseline)}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
				/>
			)}
			{renderCategoryXAxis({ xAxisKey, xAxisType, xAxisInterval, labelFormatter })}
			{children}
			{renderedSeries.map((s, i) => (
				<Area
					key={s.data_key}
					dataKey={s.data_key}
					type='monotone'
					stroke={colorFor(s.data_key, i)}
					fill={`url(#grad-${i})`}
					stackId={isStacked ? 'stack' : undefined}
					isAnimationActive={false}
				>
					{showDataLabels && !isStacked && <LabelList content={pointLabelContent.get(s.data_key)} />}
					{stackTotalLabel && i === stackTotalLabelIndex && <LabelList content={stackTotalLabel} />}
				</Area>
			))}
		</AreaChart>
	);
}

function buildScatterChart(props: ResolvedProps) {
	const { data, xAxisKey, xAxisType, series, colorFor, showGrid, children, margin, yAxisMin, yAxisMax } = props;
	const axisValues = collectAxisValues(
		data,
		series.map((s) => s.data_key),
	);

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
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				tickFormatter={formatYAxisTick}
				domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, false)}
				allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
			/>
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

function renderChartTitle(title: string) {
	return (
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
					{title}
				</text>
			)}
		/>
	);
}

type LabelCoordinate = number | string | undefined;

interface StackTotalLabelProps {
	x?: LabelCoordinate;
	y?: LabelCoordinate;
	width?: LabelCoordinate;
	index?: number;
}

interface PointLabelProps {
	x?: LabelCoordinate;
	y?: LabelCoordinate;
	value?: unknown;
	index?: number;
}

function buildPointLabelContentBySeries(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	return new Map(series.map((item) => [item.data_key, renderPointLabel(getLabeledIndices(data, item.data_key))]));
}

function DataLabelText({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
	return (
		<text x={x} y={y - 6} textAnchor='middle' dominantBaseline='alphabetic' {...DATA_LABEL_PROPS}>
			{children}
		</text>
	);
}

function renderPointLabel(labeledIndices: Set<number>) {
	return ({ x, y, value, index }: PointLabelProps) => {
		const labelX = toFiniteNumber(x);
		const labelY = toFiniteNumber(y);
		if (labelX == null || labelY == null || index == null || !labeledIndices.has(index)) {
			return null;
		}

		const label = formatDataLabel(value);
		if (!label) {
			return null;
		}

		return (
			<DataLabelText x={labelX} y={labelY}>
				{label}
			</DataLabelText>
		);
	};
}

function getLabeledIndices(
	data: Record<string, unknown>[],
	dataKey: string,
	maxLabels = MAX_LINE_AREA_DATA_LABELS,
): Set<number> {
	if (data.length <= maxLabels) {
		return new Set(data.map((_, index) => index));
	}

	const values = data.map((row) => toFiniteNumber(row[dataKey]));
	const peaks = values
		.map((value, index) => ({ value, index }))
		.filter(
			(point): point is { value: number; index: number } =>
				point.value != null && isLocalMaximum(values, point.index),
		)
		.sort((a, b) => b.value - a.value || a.index - b.index)
		.slice(0, maxLabels)
		.map((point) => point.index);

	const maxIndex = getMaxValueIndex(data, dataKey);
	if (maxIndex != null) {
		peaks.push(maxIndex);
	}

	return new Set(peaks);
}

function isLocalMaximum(values: (number | null)[], index: number): boolean {
	const value = values[index];
	if (value == null) {
		return false;
	}
	const left = values[index - 1] ?? null;
	const right = values[index + 1] ?? null;
	return (left == null || value > left) && (right == null || value > right);
}

function getMaxValueIndex(data: Record<string, unknown>[], dataKey: string): number | null {
	return (
		data.reduce<{ value: number; index: number } | null>((max, row, index) => {
			const value = toFiniteNumber(row[dataKey]);
			if (value == null || (max != null && value <= max.value)) {
				return max;
			}
			return { value, index };
		}, null)?.index ?? null
	);
}

function renderStackTotalLabel(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	return ({ x, y, width, index }: StackTotalLabelProps) => {
		const labelX = getCenteredLabelX(x, width);
		const labelY = toFiniteNumber(y);
		if (labelX == null || labelY == null || index == null) {
			return null;
		}

		const total = sumStackValue(data[index], series);
		if (total == null) {
			return null;
		}

		return (
			<DataLabelText x={labelX} y={labelY}>
				{formatCompactNumber(total)}
			</DataLabelText>
		);
	};
}

function getDataLabelSetup(props: ResolvedProps, isStacked: boolean) {
	const renderedSeries = getRenderedSeries(isStacked, props.series);
	const stackTotalLabel =
		props.showDataLabels && isStacked && renderedSeries.length > 0
			? renderStackTotalLabel(props.data, props.series)
			: undefined;
	return { renderedSeries, stackTotalLabel, stackTotalLabelIndex: renderedSeries.length - 1 };
}

function getRenderedSeries(isStacked: boolean, series: displayChart.SeriesConfig[]): displayChart.SeriesConfig[] {
	return isStacked ? series.filter((item) => !item.is_total) : series;
}

function sumStackValue(row: Record<string, unknown> | undefined, series: displayChart.SeriesConfig[]): number | null {
	if (!row) {
		return null;
	}

	const values = series.filter((s) => !s.is_total).map((s) => toFiniteNumber(row[s.data_key]));
	const numericValues = values.filter((value): value is number => value != null);
	return numericValues.length > 0 ? numericValues.reduce((sum, value) => sum + value, 0) : null;
}

function getCenteredLabelX(x: LabelCoordinate, width: LabelCoordinate): number | null {
	const labelX = toFiniteNumber(x);
	if (labelX == null) {
		return null;
	}

	const labelWidth = toFiniteNumber(width);
	return labelWidth == null ? labelX : labelX + labelWidth / 2;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
