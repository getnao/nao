import React from 'react';
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ComposedChart,
	Customized,
	Line,
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

import {
	DATA_LABEL_MARGIN_TOP,
	DATA_LABEL_X_AXIS_FOOTROOM,
	getDataLabelSetup,
	PIE_LABELLED_OUTER_RADIUS,
	renderDataLabelsLayer,
	renderPieDataLabelsLayer,
	shouldReserveDataLabelHeadroom,
	shouldReserveStackTotalFootroom,
} from './chart-data-labels';
import { collectAxisValues, collectStackedAxisValues, resolveBarYAxisDomain, resolveYAxisDomain } from './chart-domain';
import {
	attachValueAffixes,
	formatChartValue,
	formatCompactNumber,
	formatCompactUnit,
	getChartLevelValueFormat,
	niceAxisMax,
	toFiniteNumber,
} from './chart-values';
import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };
const CATEGORY_XAXIS_HEIGHT = 56;
const X_AXIS_LABEL_HEIGHT = 22;

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
const DEFAULT_BACKGROUND = 'var(--background, #ffffff)';

/**
 * Reserved width for the Y axis band. Smaller than the Recharts default (60)
 * so the tick labels sit close to the chart's left edge, aligned under the
 * title. Y values are abbreviated by `formatYAxisTick` (e.g. `1.2K`).
 */
const Y_AXIS_WIDTH = 36;
const VALUE_AXIS_DEFAULT_WIDTH = 40;
const VALUE_AXIS_MAX_WIDTH = 120;
const VALUE_AXIS_CHARACTER_WIDTH = 7;
const VALUE_AXIS_PADDING = 12;
/** Reserves horizontal room for a rotated axis title so it does not overlap tick values. */
const AXIS_LABEL_WIDTH = 20;

export function labelize(key: unknown, dateFormat?: DateFormatSettings | null): string {
	const str = String(key);
	if (isIsoDateLike(str)) {
		return formatDateValue(str, dateFormat);
	}
	return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
	if (abs >= 1_000) {
		return formatCompactUnit(value, 2);
	}
	if (Number.isInteger(value)) {
		return String(value);
	}
	return String(Number(abs < 1 ? value.toPrecision(2) : value.toFixed(2)));
}

export function computeValueAxisWidth(
	axisValues: number[],
	valueFormat?: displayChart.ValueFormat,
	hasLabel = false,
): number {
	const labelAllowance = hasLabel ? AXIS_LABEL_WIDTH : 0;
	if (axisValues.length === 0) {
		return VALUE_AXIS_DEFAULT_WIDTH + labelAllowance;
	}

	let minimumValue = axisValues[0];
	let maximumValue = axisValues[0];
	for (const value of axisValues) {
		minimumValue = Math.min(minimumValue, value);
		maximumValue = Math.max(maximumValue, value);
	}

	const candidates = [minimumValue, maximumValue, 0];
	if (maximumValue > 0) {
		candidates.push(niceAxisMax(maximumValue));
	}
	if (minimumValue < 0) {
		candidates.push(-niceAxisMax(Math.abs(minimumValue)));
	}

	const maximumLabelLength = Math.max(...candidates.map((value) => formatValueYAxisTick(value, valueFormat).length));
	const estimatedWidth =
		maximumLabelLength * VALUE_AXIS_CHARACTER_WIDTH + VALUE_AXIS_PADDING + labelAllowance + labelAllowance;
	return Math.min(
		VALUE_AXIS_MAX_WIDTH + labelAllowance + labelAllowance,
		Math.max(Y_AXIS_WIDTH + labelAllowance + labelAllowance, estimatedWidth),
	);
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

export type KpiComparisonDirection = 'up' | 'down' | 'flat';

export interface KpiComparison {
	valueText: string;
	direction: KpiComparisonDirection;
	colored: boolean;
	periodLabel: string;
}

export function computeKpiComparison(
	data: Record<string, unknown>[],
	xAxisKey: string,
	dataKey: string,
	mode: displayChart.ComparisonMode | undefined,
): KpiComparison | null {
	if (!mode || mode === 'none' || data.length < 2) {
		return null;
	}
	const currentRow = data[data.length - 1];
	const previousRow = data[data.length - 2];
	const current = toFiniteNumber(currentRow?.[dataKey]);
	const previous = toFiniteNumber(previousRow?.[dataKey]);
	if (current == null || previous == null) {
		return null;
	}
	const delta = current - previous;
	const direction: KpiComparisonDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
	const dateKey = resolveDateKey(currentRow, xAxisKey, dataKey);
	const periodLabel =
		dateKey == null ? 'previous period' : describePreviousPeriod(previousRow?.[dateKey], currentRow?.[dateKey]);

	if (mode === 'percentage') {
		if (previous === 0) {
			return null;
		}
		const pct = (delta / Math.abs(previous)) * 100;
		return { valueText: formatPercentMagnitude(Math.abs(pct)), direction, colored: true, periodLabel };
	}
	if (mode === 'variation') {
		return { valueText: formatCompactNumber(Math.abs(delta)), direction, colored: true, periodLabel };
	}
	return { valueText: formatCompactNumber(Math.abs(delta)), direction, colored: false, periodLabel };
}

function formatPercentMagnitude(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export function describePreviousPeriod(previousX: unknown, currentX: unknown): string {
	const prev = parseDateMs(previousX);
	const curr = parseDateMs(currentX);
	if (prev == null || curr == null) {
		return 'previous period';
	}
	const gapDays = Math.round((curr - prev) / 86_400_000);
	if (gapDays === 1) {
		return 'yesterday';
	}
	if (gapDays >= 6 && gapDays <= 8) {
		return 'last week';
	}
	if (gapDays >= 26 && gapDays <= 33) {
		return 'last month';
	}
	if (gapDays >= 80 && gapDays <= 100) {
		return 'last quarter';
	}
	if (gapDays >= 330 && gapDays <= 400) {
		return 'last year';
	}
	return 'previous period';
}

function resolveDateKey(row: Record<string, unknown> | undefined, xAxisKey: string, dataKey: string): string | null {
	if (xAxisKey && parseDateMs(row?.[xAxisKey]) != null) {
		return xAxisKey;
	}
	if (!row) {
		return null;
	}
	for (const key of Object.keys(row)) {
		if (key !== dataKey && parseDateMs(row[key]) != null) {
			return key;
		}
	}
	return null;
}

function parseDateMs(value: unknown): number | null {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	if (!/^\d{4}-\d{2}(?:-\d{2})?(?:[ T].*)?$/.test(trimmed)) {
		return null;
	}
	const normalized = trimmed.length === 7 ? `${trimmed}-01` : trimmed.replace(' ', 'T');
	const ms = new Date(normalized).getTime();
	return Number.isNaN(ms) ? null : ms;
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
	valueFormatter?: (value: number) => string;
	showGrid?: boolean;
	children?: React.ReactNode[];
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	title?: string;
	renderTitle?: boolean;
	maxXAxisTicks?: number;
	compactXAxis?: boolean;
	compactXAxisInterval?: number;
	xAxisTickFontSize?: number;
	xAxisMaxLabelChars?: number;
	xAxisLabel?: string;
	yAxisMin?: number;
	yAxisMax?: number;
	yAxisLabel?: string;
	yAxisRightMin?: number;
	yAxisRightMax?: number;
	yAxisRightLabel?: string;
	/** Chart background color, used as the separator between stacked segments. Pass a concrete color on surfaces where CSS vars do not resolve (backend PNG/HTML export). */
	backgroundColor?: string;
	/** Prefix for SVG gradient ids so multiple charts on one page (and drag clones) don't collide. */
	gradientIdPrefix?: string;
	showDataLabels?: boolean;
	/** When true, Recharts animates series as data changes (e.g. story filters). */
	animate?: boolean;
	comparisonMode?: displayChart.ComparisonMode;
	idPrefix?: string;
	/** Optional node rendered inline to the left of the first KPI card's title (used for a per-column drag handle in the story editor). */
	kpiLeadingSlot?: React.ReactNode;
}

const CHART_ANIMATION_DURATION_MS = 400;

/**
 * Builds a Recharts element tree from a display_chart tool config.
 *
 * Used by both the frontend (wrapped in ChartContainer + tooltips) and the
 * backend (rendered to SVG via renderToStaticMarkup for image generation).
 */
export function buildChart(props: BuildChartProps) {
	const resolved = buildResolved(props);

	if (resolved.chartType === 'kpi_card') {
		return buildKpiCard(resolved, props.kpiLeadingSlot);
	}
	if (displayChart.isPieChart(resolved.chartType)) {
		return buildPieChart(resolved);
	}
	if (displayChart.isComboChart(resolved.chartType)) {
		return buildComboChart(resolved);
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
	Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter' | 'backgroundColor'>> & {
		xAxisInterval?: number;
	};

function buildChartMargin(props: BuildChartProps, showTitle: boolean) {
	const titleTop = showTitle ? 30 : 0;
	const labelsTop = shouldReserveDataLabelHeadroom(props) ? DATA_LABEL_MARGIN_TOP : 0;
	if (titleTop === 0 && labelsTop === 0) {
		return props.margin;
	}
	return { ...props.margin, top: (props.margin?.top ?? 0) + titleTop + labelsTop };
}

function buildKpiCard(props: ResolvedProps, leadingSlot?: React.ReactNode) {
	const { data, series } = props;

	return (
		<KpiCardContainer>
			{series.map((s, index) => (
				<KpiCard
					key={s.data_key}
					value={data[data.length - 1]?.[s.data_key]}
					displayName={s.label ?? s.data_key}
					comparison={computeKpiComparison(data, props.xAxisKey, s.data_key, props.comparisonMode)}
					valueFormat={s.value_format}
					leadingSlot={index === 0 ? leadingSlot : undefined}
				/>
			))}
		</KpiCardContainer>
	);
}

function KpiCardContainer({ children }: { children: React.ReactNode }) {
	return <div className='flex w-full flex-wrap justify-start gap-4'>{children}</div>;
}

function KpiCard({
	value,
	displayName,
	comparison,
	valueFormat,
	leadingSlot,
}: {
	value: unknown;
	displayName: string;
	comparison: KpiComparison | null;
	valueFormat?: displayChart.ValueFormat;
	leadingSlot?: React.ReactNode;
}) {
	let formattedValue = '';

	if (typeof value === 'number') {
		formattedValue = formatChartValue(value, valueFormat);
	} else if (typeof value === 'string') {
		formattedValue = value;
	}

	const showArrowAndColor = comparison != null && comparison.colored && comparison.direction !== 'flat';
	const pillColorClass = showArrowAndColor
		? comparison.direction === 'up'
			? 'text-green-600'
			: 'text-red-600'
		: 'text-muted-foreground';

	return (
		<div className='min-w-[160px]'>
			<div className='flex items-center gap-1'>
				{leadingSlot}
				<div className='text-lg tracking-wide'>{displayName}</div>
			</div>
			<div className='text-3xl font-medium tabular-nums'>{formattedValue}</div>
			{comparison && (
				<div className={`mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-sm ${pillColorClass}`}>
					{showArrowAndColor && <KpiTrendArrow direction={comparison.direction} />}
					<span className='font-medium tabular-nums'>{comparison.valueText}</span>
					<span className='font-normal'>vs. {comparison.periodLabel}</span>
				</div>
			)}
		</div>
	);
}

function KpiTrendArrow({ direction }: { direction: KpiComparisonDirection }) {
	return (
		<svg
			width='10'
			height='10'
			viewBox='0 0 14 12'
			fill='currentColor'
			stroke='currentColor'
			strokeWidth='1.6'
			strokeLinejoin='round'
			aria-hidden='true'
			className='shrink-0'
		>
			<path d={direction === 'up' ? 'M7 2.5 12 10 2 10Z' : 'M2 2.5 12 2.5 7 10Z'} />
		</svg>
	);
}

function renderValueYAxis(isPercent = false, valueFormatter = formatYAxisTick, yAxisLabel?: string) {
	return (
		<YAxis
			width={Y_AXIS_WIDTH + (yAxisLabel ? AXIS_LABEL_WIDTH : 0)}
			tick={AXIS_TICK}
			tickLine={false}
			axisLine={false}
			minTickGap={12}
			domain={isPercent ? [0, 1] : undefined}
			tickFormatter={isPercent ? formatPercentAxisTick : valueFormatter}
			label={axisLabel(yAxisLabel, 'left')}
		/>
	);
}

function formatValueYAxisTick(value: number, valueFormat?: displayChart.ValueFormat): string {
	if (!valueFormat) {
		return formatYAxisTick(value);
	}
	if (valueFormat.d3_format) {
		return formatChartValue(value, valueFormat, { compact: true });
	}
	return attachValueAffixes(formatYAxisTick(value), valueFormat);
}

function renderCategoryXAxis({
	xAxisKey,
	xAxisType,
	xAxisInterval,
	labelFormatter,
	compact,
	compactInterval,
	tickFontSize,
	maxLabelChars,
	labelFootroom = 0,
	xAxisLabel,
}: {
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	xAxisInterval?: number;
	labelFormatter: (value: string) => string;
	compact?: boolean;
	compactInterval?: number;
	tickFontSize?: number;
	maxLabelChars?: number;
	labelFootroom?: number;
	xAxisLabel?: string;
}) {
	const tickFormatter = compact
		? (value: string) => {
				const label = labelFormatter(value);
				if (maxLabelChars == null) {
					return label;
				}
				const cap = Math.max(3, maxLabelChars);
				return label.length > cap ? `${label.slice(0, cap - 1)}…` : label;
			}
		: labelFormatter;

	return (
		<XAxis
			dataKey={xAxisKey}
			type={xAxisType}
			domain={['dataMin', 'dataMax']}
			tick={compact ? { ...AXIS_TICK, fontSize: tickFontSize ?? AXIS_TICK.fontSize } : AXIS_TICK}
			tickLine
			tickMargin={10 + labelFootroom}
			axisLine={false}
			minTickGap={12}
			interval={compact ? (compactInterval ?? 0) : xAxisInterval}
			tickFormatter={tickFormatter}
			height={CATEGORY_XAXIS_HEIGHT + labelFootroom + (xAxisLabel ? X_AXIS_LABEL_HEIGHT : 0)}
			label={xAxisLabelProps(xAxisLabel)}
			{...(compact ? { angle: -35, textAnchor: 'end' as const } : {})}
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
		compactXAxis,
		compactXAxisInterval,
		xAxisTickFontSize,
		xAxisMaxLabelChars,
		series,
		xAxisLabel,
		yAxisMin,
		yAxisMax,
		yAxisLabel,
		showDataLabels,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const { renderedSeries, stackTotalLayer } = getDataLabelSetup(props, isStacked);
	const dataKeys = renderedSeries.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const seriesKeys = renderedSeries.map((s) => s.data_key);
	const separatorColor = props.backgroundColor ?? DEFAULT_BACKGROUND;
	const labelFootroom = shouldReserveStackTotalFootroom(props) ? DATA_LABEL_X_AXIS_FOOTROOM : 0;
	const chartLevelFormat = getChartLevelValueFormat(series);
	const yAxisDomain = isPercent
		? undefined
		: resolveBarYAxisDomain(yAxisMin, yAxisMax, axisValues, showDataLabels === true);
	const valueAxisValues = typeof yAxisDomain?.[1] === 'number' ? [...axisValues, yAxisDomain[1]] : axisValues;
	const valueAxisWidth = computeValueAxisWidth(valueAxisValues, chartLevelFormat, Boolean(yAxisLabel));
	const dataLabelsLayer = showDataLabels && !isStacked ? renderDataLabelsLayer(series) : undefined;

	return (
		<BarChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			{isPercent ? (
				renderValueYAxis(true, formatYAxisTick, yAxisLabel)
			) : (
				<YAxis
					width={valueAxisWidth}
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={(value: number) => formatValueYAxisTick(value, chartLevelFormat)}
					domain={yAxisDomain}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
					label={axisLabel(yAxisLabel, 'left')}
				/>
			)}
			{renderCategoryXAxis({
				xAxisKey,
				xAxisType: xAxisType ?? 'category',
				xAxisInterval,
				labelFormatter,
				compact: compactXAxis,
				compactInterval: compactXAxisInterval,
				tickFontSize: xAxisTickFontSize,
				maxLabelChars: xAxisMaxLabelChars,
				labelFootroom,
				xAxisLabel,
			})}
			{children}
			{renderedSeries.map((s, i) => (
				<Bar
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					stackId={isStacked ? 'stack' : undefined}
					radius={isStacked ? undefined : [4, 4, 4, 4]}
					shape={isStacked ? renderStackedBarShape(seriesKeys, s.data_key, separatorColor) : undefined}
					isAnimationActive={Boolean(props.animate)}
					animationDuration={CHART_ANIMATION_DURATION_MS}
				/>
			))}
			{stackTotalLayer && <Customized component={stackTotalLayer} />}
			{dataLabelsLayer && <Customized component={dataLabelsLayer} />}
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
		compactXAxis,
		compactXAxisInterval,
		xAxisTickFontSize,
		xAxisMaxLabelChars,
		xAxisLabel,
		yAxisMin,
		yAxisMax,
		yAxisLabel,
		showDataLabels,
	} = props;
	const gradientIdPrefix = props.gradientIdPrefix ?? '';
	const gradientIdFor = (index: number) => `${gradientIdPrefix}grad-${index}`;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const zeroBaseline = chartType !== 'line';
	const { renderedSeries, stackTotalLayer } = getDataLabelSetup(props, isStacked);
	const dataKeys = renderedSeries.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const labelFootroom = shouldReserveStackTotalFootroom(props) ? DATA_LABEL_X_AXIS_FOOTROOM : 0;
	const chartLevelFormat = getChartLevelValueFormat(series);
	const valueAxisWidth = computeValueAxisWidth(axisValues, chartLevelFormat, Boolean(yAxisLabel));
	const dataLabelsLayer = showDataLabels && !isStacked ? renderDataLabelsLayer(series) : undefined;

	return (
		<AreaChart data={data} accessibilityLayer margin={margin} stackOffset={isPercent ? 'expand' : undefined}>
			<defs>
				{renderedSeries.map((s, i) => {
					const color = colorFor(s.data_key, i);
					const gradientId = gradientIdFor(i);
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
				renderValueYAxis(true, formatYAxisTick, yAxisLabel)
			) : (
				<YAxis
					width={valueAxisWidth}
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={(value: number) => formatValueYAxisTick(value, chartLevelFormat)}
					domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, zeroBaseline)}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
					label={axisLabel(yAxisLabel, 'left')}
				/>
			)}
			{renderCategoryXAxis({
				xAxisKey,
				xAxisType,
				xAxisInterval,
				labelFormatter,
				compact: compactXAxis,
				compactInterval: compactXAxisInterval,
				tickFontSize: xAxisTickFontSize,
				maxLabelChars: xAxisMaxLabelChars,
				labelFootroom,
				xAxisLabel,
			})}
			{children}
			{renderedSeries.map((s, i) => (
				<Area
					key={s.data_key}
					dataKey={s.data_key}
					type='monotone'
					stroke={colorFor(s.data_key, i)}
					fill={`url(#${gradientIdFor(i)})`}
					stackId={isStacked ? 'stack' : undefined}
					isAnimationActive={Boolean(props.animate)}
					animationDuration={CHART_ANIMATION_DURATION_MS}
				/>
			))}
			{stackTotalLayer && <Customized component={stackTotalLayer} />}
			{dataLabelsLayer && <Customized component={dataLabelsLayer} />}
		</AreaChart>
	);
}

function comboSeriesType(series: displayChart.SeriesConfig, baseType: displayChart.ChartType): displayChart.SeriesType {
	if (series.series_type) {
		return series.series_type;
	}
	return baseType === 'line' || baseType === 'area' ? baseType : 'bar';
}

function comboAxisSide(series: displayChart.SeriesConfig): displayChart.YAxisSide {
	return series.y_axis === 'right' ? 'right' : 'left';
}

function buildComboChart(props: ResolvedProps) {
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
		compactXAxis,
		compactXAxisInterval,
		xAxisTickFontSize,
		xAxisMaxLabelChars,
		yAxisMin,
		yAxisMax,
		yAxisLabel,
		yAxisRightMin,
		yAxisRightMax,
		yAxisRightLabel,
		showDataLabels,
		idPrefix = '',
	} = props;

	const leftSeries = series.filter((s) => comboAxisSide(s) === 'left');
	const rightSeries = series.filter((s) => comboAxisSide(s) === 'right');
	const leftFormat = getChartLevelValueFormat(leftSeries);
	const rightFormat = getChartLevelValueFormat(rightSeries);
	const leftDomain = resolveComboAxisDomain(data, leftSeries, yAxisMin, yAxisMax);
	const rightDomain = resolveComboAxisDomain(data, rightSeries, yAxisRightMin, yAxisRightMax);
	const leftAxisWidth = computeComboAxisWidth(data, leftSeries, leftFormat, Boolean(yAxisLabel));
	const rightAxisWidth = computeComboAxisWidth(data, rightSeries, rightFormat, Boolean(yAxisRightLabel));
	const areaSeries = series.filter((s) => comboSeriesType(s, chartType) === 'area');
	const dataLabelsLayer = showDataLabels ? renderDataLabelsLayer(series) : undefined;

	return (
		<ComposedChart data={data} accessibilityLayer margin={margin}>
			{areaSeries.length > 0 && (
				<defs>
					{series.map((s, i) =>
						comboSeriesType(s, chartType) === 'area' ? (
							<linearGradient
								key={s.data_key}
								id={`${idPrefix}grad-combo-${i}`}
								x1='0'
								y1='0'
								x2='0'
								y2='1'
							>
								<stop offset='0%' stopColor={colorFor(s.data_key, i)} stopOpacity={0.25} />
								<stop offset='100%' stopColor={colorFor(s.data_key, i)} stopOpacity={0} />
							</linearGradient>
						) : null,
					)}
				</defs>
			)}
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			{leftSeries.length > 0 && (
				<YAxis
					yAxisId='left'
					width={leftAxisWidth}
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={(value: number) => formatValueYAxisTick(value, leftFormat)}
					domain={leftDomain}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
					label={axisLabel(yAxisLabel, 'left')}
				/>
			)}
			{rightSeries.length > 0 && (
				<YAxis
					yAxisId='right'
					width={rightAxisWidth}
					orientation='right'
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={(value: number) => formatValueYAxisTick(value, rightFormat)}
					domain={rightDomain}
					allowDataOverflow={yAxisRightMin !== undefined || yAxisRightMax !== undefined}
					label={axisLabel(yAxisRightLabel, 'right')}
				/>
			)}
			{renderCategoryXAxis({
				xAxisKey,
				xAxisType: xAxisType ?? 'category',
				xAxisInterval,
				labelFormatter,
				compact: compactXAxis,
				compactInterval: compactXAxisInterval,
				tickFontSize: xAxisTickFontSize,
				maxLabelChars: xAxisMaxLabelChars,
			})}
			{children}
			{series.map((s, i) => renderComboSeries(s, i, chartType, colorFor, idPrefix))}
			{dataLabelsLayer && <Customized component={dataLabelsLayer} />}
		</ComposedChart>
	);
}

function resolveComboAxisDomain(
	data: Record<string, unknown>[],
	axisSeries: displayChart.SeriesConfig[],
	explicitMin: number | undefined,
	explicitMax: number | undefined,
) {
	const values = collectAxisValues(
		data,
		axisSeries.map((s) => s.data_key),
	);
	return resolveYAxisDomain(explicitMin, explicitMax, values, true);
}

function computeComboAxisWidth(
	data: Record<string, unknown>[],
	axisSeries: displayChart.SeriesConfig[],
	valueFormat?: displayChart.ValueFormat,
	hasLabel = false,
) {
	const values = collectAxisValues(
		data,
		axisSeries.map((s) => s.data_key),
	);
	return computeValueAxisWidth(values, valueFormat, hasLabel);
}

function renderComboSeries(
	series: displayChart.SeriesConfig,
	index: number,
	baseType: displayChart.ChartType,
	colorFor: (key: string, index: number) => string,
	idPrefix: string,
) {
	const color = colorFor(series.data_key, index);
	const yAxisId = comboAxisSide(series);
	const type = comboSeriesType(series, baseType);

	if (type === 'line') {
		return (
			<Line
				key={series.data_key}
				yAxisId={yAxisId}
				dataKey={series.data_key}
				type='monotone'
				stroke={color}
				strokeWidth={2}
				dot={false}
				isAnimationActive={false}
			/>
		);
	}
	if (type === 'area') {
		return (
			<Area
				key={series.data_key}
				yAxisId={yAxisId}
				dataKey={series.data_key}
				type='monotone'
				stroke={color}
				fill={`url(#${idPrefix}grad-combo-${index})`}
				isAnimationActive={false}
			/>
		);
	}
	return (
		<Bar
			key={series.data_key}
			yAxisId={yAxisId}
			dataKey={series.data_key}
			fill={color}
			radius={[4, 4, 4, 4]}
			isAnimationActive={false}
		/>
	);
}

const AXIS_LABEL_STYLE = { textAnchor: 'middle' as const, fontSize: 12, fill: 'var(--muted-foreground, #6b7280)' };

function axisLabel(label: string | undefined, side: displayChart.YAxisSide) {
	if (!label) {
		return undefined;
	}
	return {
		value: label,
		angle: -90,
		position: side === 'left' ? ('insideLeft' as const) : ('insideRight' as const),
		style: AXIS_LABEL_STYLE,
	};
}

function xAxisLabelProps(label: string | undefined) {
	if (!label) {
		return undefined;
	}
	return { value: label, position: 'insideBottom' as const, offset: 0, style: AXIS_LABEL_STYLE };
}

function buildScatterChart(props: ResolvedProps) {
	const {
		data,
		xAxisKey,
		xAxisType,
		series,
		colorFor,
		showGrid,
		children,
		margin,
		xAxisLabel,
		yAxisMin,
		yAxisMax,
		yAxisLabel,
	} = props;
	const chartLevelFormat = getChartLevelValueFormat(series);
	const axisValues = collectAxisValues(
		data,
		series.map((s) => s.data_key),
	);
	const valueAxisWidth = computeValueAxisWidth(axisValues, chartLevelFormat, Boolean(yAxisLabel));

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
				height={CATEGORY_XAXIS_HEIGHT + (xAxisLabel ? X_AXIS_LABEL_HEIGHT : 0)}
				label={xAxisLabelProps(xAxisLabel)}
			/>
			<YAxis
				width={valueAxisWidth}
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				tickFormatter={(value: number) => formatValueYAxisTick(value, chartLevelFormat)}
				domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, false)}
				allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
				label={axisLabel(yAxisLabel, 'left')}
			/>
			{children}
			{series.map((s, i) => (
				<Scatter
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					isAnimationActive={Boolean(props.animate)}
					animationDuration={CHART_ANIMATION_DURATION_MS}
				/>
			))}
		</ScatterChart>
	);
}

function buildRadarChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, children, margin } = props;
	const chartLevelFormat = getChartLevelValueFormat(series);

	return (
		<RadarChart data={data} accessibilityLayer margin={margin}>
			<PolarGrid />
			<PolarAngleAxis dataKey={xAxisKey} tick={AXIS_TICK} />
			<PolarRadiusAxis
				tick={AXIS_TICK}
				tickFormatter={(value: number) => formatValueYAxisTick(value, chartLevelFormat)}
			/>
			{children}
			{series.map((s, i) => (
				<Radar
					key={s.data_key}
					dataKey={s.data_key}
					stroke={colorFor(s.data_key, i)}
					fill={colorFor(s.data_key, i)}
					fillOpacity={0.3}
					isAnimationActive={Boolean(props.animate)}
					animationDuration={CHART_ANIMATION_DURATION_MS}
				/>
			))}
		</RadarChart>
	);
}

function buildPieChart(props: ResolvedProps) {
	const { data, chartType, xAxisKey, series, colorFor, children, margin, backgroundColor, showDataLabels } = props;
	const dataKey = series[0].data_key;
	const dataLabelsLayer = showDataLabels ? renderPieDataLabelsLayer(series[0].value_format) : undefined;

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
				outerRadius={showDataLabels ? PIE_LABELLED_OUTER_RADIUS : undefined}
				label={false}
				labelLine={false}
				stroke={backgroundColor}
				strokeWidth={1}
				isAnimationActive={Boolean(props.animate)}
				animationDuration={CHART_ANIMATION_DURATION_MS}
			/>
			{dataLabelsLayer && <Customized component={dataLabelsLayer} />}
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
