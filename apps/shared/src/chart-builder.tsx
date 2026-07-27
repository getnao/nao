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

import { collectAxisValues, collectStackedAxisValues, resolveYAxisDomain } from './chart-domain';
import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';
import * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#104e64', '#f54900', '#009689', '#ffb900', '#fe9a00'];

const AXIS_TICK = { fontSize: 12 };
const CATEGORY_XAXIS_HEIGHT = 56;
const DATA_LABEL_PROPS = {
	fill: 'var(--foreground, #111827)',
	fontSize: 11,
	fontFamily: 'system-ui, sans-serif',
};
const DATA_LABEL_MARGIN_TOP = 24;
const DATA_LABEL_HEADROOM_RATIO = 0.9;

const DATA_LABEL_FONT_SIZE = 11;
/** Approximate glyph width as a fraction of the font size; used to size collision boxes without a DOM. */
const DATA_LABEL_CHAR_WIDTH_RATIO = 0.6;
/** Vertical clearance between the anchor point/line (or bar edge) and the nearest edge of a label. */
const DATA_LABEL_ANCHOR_GAP = 8;
/** Padding added around each label's collision box so neighbours keep a little breathing room. */
const DATA_LABEL_BOX_PADDING = 2;
/** Series kinds whose points we place labels for; stacked/pie use their own paths. */
const LABELLED_SERIES_KINDS = new Set(['Bar', 'Line', 'Area']);

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
	valueFormatter?: (value: number) => string;
	showGrid?: boolean;
	children?: React.ReactNode[];
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	title?: string;
	renderTitle?: boolean;
	maxXAxisTicks?: number;
	compactXAxis?: boolean;
	xAxisTickFontSize?: number;
	xAxisMaxLabelChars?: number;
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
		return buildKpiCard(resolved);
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

export function shouldReserveDataLabelHeadroom(props: BuildChartProps): boolean {
	if (props.showDataLabels !== true || !isCartesianLabelChart(props.chartType)) {
		return false;
	}
	// Stacked charts label the running total at the very top of the stack, which can sit flush against
	// the axis top, so always keep room for that label rather than relying on the axis-headroom ratio.
	if (props.chartType === 'stacked_bar' || props.chartType === 'stacked_area') {
		return true;
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
		chartType === 'stacked_area' ||
		chartType === 'mixed'
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
	const { data, series, valueFormatter } = props;

	return (
		<KpiCardContainer>
			{series.map((s) => (
				<KpiCard
					key={s.data_key}
					value={data[data.length - 1]?.[s.data_key]}
					displayName={s.label ?? s.data_key}
					comparison={computeKpiComparison(data, props.xAxisKey, s.data_key, props.comparisonMode)}
					valueFormatter={valueFormatter}
				/>
			))}
		</KpiCardContainer>
	);
}

function KpiCardContainer({ children }: { children: React.ReactNode }) {
	return <div className='flex flex-wrap gap-4 w-full justify-start'>{children}</div>;
}

function KpiCard({
	value,
	displayName,
	comparison,
	valueFormatter = formatCompactNumber,
}: {
	value: unknown;
	displayName: string;
	comparison: KpiComparison | null;
	valueFormatter?: (value: number) => string;
}) {
	let formattedValue = '';

	if (typeof value === 'number') {
		formattedValue = valueFormatter(value);
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
			<div className='text-lg tracking-wide'>{displayName}</div>
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

function renderValueYAxis(isPercent = false, valueFormatter = formatYAxisTick) {
	return (
		<YAxis
			width={Y_AXIS_WIDTH}
			tick={AXIS_TICK}
			tickLine={false}
			axisLine={false}
			minTickGap={12}
			domain={isPercent ? [0, 1] : undefined}
			tickFormatter={isPercent ? formatPercentAxisTick : valueFormatter}
		/>
	);
}

function renderCategoryXAxis({
	xAxisKey,
	xAxisType,
	xAxisInterval,
	labelFormatter,
	compact,
	tickFontSize,
	maxLabelChars,
}: {
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	xAxisInterval?: number;
	labelFormatter: (value: string) => string;
	compact?: boolean;
	tickFontSize?: number;
	maxLabelChars?: number;
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
			tickMargin={10}
			axisLine={false}
			minTickGap={12}
			interval={compact ? 0 : xAxisInterval}
			tickFormatter={tickFormatter}
			height={CATEGORY_XAXIS_HEIGHT}
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
		xAxisTickFontSize,
		xAxisMaxLabelChars,
		series,
		yAxisMin,
		yAxisMax,
		showDataLabels,
		valueFormatter,
	} = props;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const dataKeys = series.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const { renderedSeries, stackTotalLayer } = getDataLabelSetup(props, isStacked);
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
					tickFormatter={valueFormatter ?? formatYAxisTick}
					domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, true)}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
				/>
			)}
			{renderCategoryXAxis({
				xAxisKey,
				xAxisType: xAxisType ?? 'category',
				xAxisInterval,
				labelFormatter,
				compact: compactXAxis,
				tickFontSize: xAxisTickFontSize,
				maxLabelChars: xAxisMaxLabelChars,
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
			{showDataLabels && !isStacked && <Customized component={DataLabelsLayer} />}
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
		xAxisTickFontSize,
		xAxisMaxLabelChars,
		yAxisMin,
		yAxisMax,
		showDataLabels,
		valueFormatter,
	} = props;
	const gradientIdPrefix = props.gradientIdPrefix ?? '';
	const gradientIdFor = (index: number) => `${gradientIdPrefix}grad-${index}`;
	const isStacked = displayChart.isStackedChartType(chartType);
	const isPercent = displayChart.isPercentStackedChartType(chartType);
	const zeroBaseline = chartType !== 'line';
	const dataKeys = series.map((s) => s.data_key);
	const axisValues = isStacked ? collectStackedAxisValues(data, dataKeys) : collectAxisValues(data, dataKeys);
	const { renderedSeries, stackTotalLayer } = getDataLabelSetup(props, isStacked);

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
				renderValueYAxis(true)
			) : (
				<YAxis
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={valueFormatter ?? formatYAxisTick}
					domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, zeroBaseline)}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
				/>
			)}
			{renderCategoryXAxis({
				xAxisKey,
				xAxisType,
				xAxisInterval,
				labelFormatter,
				compact: compactXAxis,
				tickFontSize: xAxisTickFontSize,
				maxLabelChars: xAxisMaxLabelChars,
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
			{showDataLabels && !isStacked && <Customized component={DataLabelsLayer} />}
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
	const leftDomain = resolveComboAxisDomain(data, leftSeries, yAxisMin, yAxisMax);
	const rightDomain = resolveComboAxisDomain(data, rightSeries, yAxisRightMin, yAxisRightMax);
	const areaSeries = series.filter((s) => comboSeriesType(s, chartType) === 'area');

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
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={formatYAxisTick}
					domain={leftDomain}
					allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
					label={axisLabel(yAxisLabel, 'left')}
				/>
			)}
			{rightSeries.length > 0 && (
				<YAxis
					yAxisId='right'
					orientation='right'
					tick={AXIS_TICK}
					tickLine={false}
					axisLine={false}
					minTickGap={12}
					tickFormatter={formatYAxisTick}
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
			})}
			{children}
			{series.map((s, i) => renderComboSeries(s, i, chartType, colorFor, idPrefix))}
			{showDataLabels && <Customized component={DataLabelsLayer} />}
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

function axisLabel(label: string | undefined, side: displayChart.YAxisSide) {
	if (!label) {
		return undefined;
	}
	return {
		value: label,
		angle: -90,
		position: side === 'left' ? ('insideLeft' as const) : ('insideRight' as const),
		style: { textAnchor: 'middle' as const, fontSize: 12, fill: 'var(--muted-foreground, #6b7280)' },
	};
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
		yAxisMin,
		yAxisMax,
		valueFormatter,
	} = props;
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
				height={CATEGORY_XAXIS_HEIGHT}
			/>
			<YAxis
				tick={AXIS_TICK}
				tickLine={false}
				axisLine={false}
				minTickGap={12}
				tickFormatter={valueFormatter ?? formatYAxisTick}
				domain={resolveYAxisDomain(yAxisMin, yAxisMax, axisValues, false)}
				allowDataOverflow={yAxisMin !== undefined || yAxisMax !== undefined}
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
	const { data, xAxisKey, series, colorFor, children, margin, valueFormatter } = props;

	return (
		<RadarChart data={data} accessibilityLayer margin={margin}>
			<PolarGrid />
			<PolarAngleAxis dataKey={xAxisKey} tick={AXIS_TICK} />
			<PolarRadiusAxis tick={AXIS_TICK} tickFormatter={valueFormatter ?? formatYAxisTick} />
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
				label={showDataLabels ? renderPieDataLabel : false}
				labelLine={false}
				stroke={backgroundColor}
				strokeWidth={1}
				isAnimationActive={Boolean(props.animate)}
				animationDuration={CHART_ANIMATION_DURATION_MS}
			/>
			{children}
		</PieChart>
	);
}

function renderPieDataLabel(props: {
	x?: number;
	y?: number;
	textAnchor?: 'start' | 'middle' | 'end';
	value?: unknown;
}) {
	const { x, y, textAnchor, value } = props;
	const label = formatDataLabel(value);
	if (x == null || y == null || !label) {
		return null;
	}
	return (
		<text x={x} y={y} textAnchor={textAnchor} dominantBaseline='central' {...DATA_LABEL_PROPS}>
			{label}
		</text>
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

function isLocalMaximum(values: (number | null)[], index: number): boolean {
	const value = values[index];
	if (value == null) {
		return false;
	}
	const left = values[index - 1] ?? null;
	const right = values[index + 1] ?? null;
	return (left == null || value > left) && (right == null || value > right);
}

function isLocalMinimum(values: (number | null)[], index: number): boolean {
	const value = values[index];
	if (value == null) {
		return false;
	}
	const left = values[index - 1] ?? null;
	const right = values[index + 1] ?? null;
	return (left == null || value < left) && (right == null || value < right);
}

/** A point is a local extremum when its value turns direction — a peak or a trough versus neighbours. */
function isLocalExtremum(values: (number | null)[], index: number): boolean {
	return isLocalMaximum(values, index) || isLocalMinimum(values, index);
}

interface PlotRect {
	top?: number;
	left?: number;
	width?: number;
	height?: number;
}

interface GraphicalPoint {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	value?: unknown;
}

interface GraphicalItem {
	item?: { type?: { displayName?: string } };
	props?: { points?: GraphicalPoint[]; data?: GraphicalPoint[] };
}

interface DataLabelsLayerProps {
	formattedGraphicalItems?: GraphicalItem[];
	offset?: PlotRect;
}

interface LabelCandidate {
	cx: number;
	baselineY: number;
	box: LabelBox;
	text: string;
	seriesIndex: number;
	isExtremum: boolean;
}

interface LabelBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * Single label layer for cartesian charts. Recharts renders each series' labels in isolation, so
 * labels from different series (or a line crossing a bar) collide with no way to coordinate. Rendered
 * through `<Customized>`, this layer sees every series' computed pixel geometry at once.
 *
 * Philosophy: less is more, and every label is fully predictable. Each label is drawn at its natural
 * position (centred, one gap above its point/bar; below for negative bars) or not at all — never
 * nudged sideways or vertically, which is what made earlier attempts hard to read. When two labels'
 * boxes overlap, one is dropped by a deterministic priority: a local extremum (peak/trough) beats a
 * non-extremum; otherwise the earlier series wins; ties break left-to-right.
 */
function DataLabelsLayer({ formattedGraphicalItems, offset }: DataLabelsLayerProps) {
	return renderDataLabels(collectLabelCandidates(formattedGraphicalItems ?? [], offset ?? {}));
}

/**
 * Labels a stacked chart's running totals (one per x, at the top of the stack) through the same
 * declutter pipeline as everything else — otherwise they render as a raw `LabelList` and pile up. The
 * total per point comes from the source rows, positioned on the topmost band's computed geometry.
 */
function renderStackTotalLabelsLayer(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	return function StackTotalLabelsLayer({ formattedGraphicalItems, offset }: DataLabelsLayerProps) {
		const items = (formattedGraphicalItems ?? []).filter(isLabelledItem);
		const top = items[items.length - 1];
		const kind = top?.item?.type?.displayName;
		const points = kind === 'Bar' ? top?.props?.data : top?.props?.points;
		if (!top || !points || points.length === 0) {
			return null;
		}
		const totals = points.map((_, index) => sumStackValue(data[index], series));
		return renderDataLabels(seriesCandidates(points, totals, kind === 'Bar', 0, offset ?? {}));
	};
}

function renderDataLabels(candidates: LabelCandidate[]) {
	if (candidates.length === 0) {
		return null;
	}
	const placed = resolveOverlaps(candidates);
	return (
		<g className='recharts-data-labels'>
			{placed.map((label, index) => (
				<text
					key={index}
					x={label.cx}
					y={label.baselineY}
					textAnchor='middle'
					dominantBaseline='alphabetic'
					{...DATA_LABEL_PROPS}
				>
					{label.text}
				</text>
			))}
		</g>
	);
}

function isLabelledItem(entry: GraphicalItem): boolean {
	const kind = entry.item?.type?.displayName;
	return kind != null && LABELLED_SERIES_KINDS.has(kind);
}

function collectLabelCandidates(items: GraphicalItem[], plot: PlotRect): LabelCandidate[] {
	return items.flatMap((entry, seriesIndex) => {
		const kind = entry.item?.type?.displayName;
		if (!kind || !LABELLED_SERIES_KINDS.has(kind)) {
			return [];
		}
		const points = kind === 'Bar' ? entry.props?.data : entry.props?.points;
		if (!points || points.length === 0) {
			return [];
		}
		return seriesCandidates(points, points.map(pointNumericValue), kind === 'Bar', seriesIndex, plot);
	});
}

function seriesCandidates(
	points: GraphicalPoint[],
	values: (number | null)[],
	isBar: boolean,
	seriesIndex: number,
	plot: PlotRect,
): LabelCandidate[] {
	return points.flatMap((point, index) => {
		const value = values[index];
		if (value == null) {
			return [];
		}
		const text = formatDataLabel(value);
		if (!text) {
			return [];
		}
		const anchor = labelAnchor(point, value, isBar);
		if (anchor == null) {
			return [];
		}
		const halfWidth = (text.length * DATA_LABEL_FONT_SIZE * DATA_LABEL_CHAR_WIDTH_RATIO) / 2;
		const box = labelBox(anchor.cx, anchor.baselineY, halfWidth);
		// A label clipped by the chart edge at its natural position is unreadable, so drop it outright.
		if (!fitsHorizontally(anchor.cx, halfWidth, plot) || !fitsVertically(box, plot)) {
			return [];
		}
		return [
			{
				cx: anchor.cx,
				baselineY: anchor.baselineY,
				box,
				text,
				seriesIndex,
				isExtremum: isLocalExtremum(values, index),
			},
		];
	});
}

/** Area/line points carry `value` as a `[baseLine, value]` range; bars carry a scalar. Unwrap both. */
function pointNumericValue(point: GraphicalPoint): number | null {
	const raw = Array.isArray(point.value) ? point.value[point.value.length - 1] : point.value;
	return toFiniteNumber(raw);
}

/** Natural label position: one gap above the point/bar-top (below the bar for negative bars). */
function labelAnchor(point: GraphicalPoint, value: number, isBar: boolean): { cx: number; baselineY: number } | null {
	const x = toFiniteNumber(point.x);
	const y = toFiniteNumber(point.y);
	if (x == null || y == null) {
		return null;
	}
	if (!isBar) {
		return { cx: x, baselineY: y - DATA_LABEL_ANCHOR_GAP };
	}
	const width = toFiniteNumber(point.width) ?? 0;
	const height = toFiniteNumber(point.height) ?? 0;
	return value >= 0
		? { cx: x + width / 2, baselineY: y - DATA_LABEL_ANCHOR_GAP }
		: { cx: x + width / 2, baselineY: y + height + DATA_LABEL_ANCHOR_GAP + DATA_LABEL_FONT_SIZE };
}

/**
 * Keeps labels at their natural position and drops conflicts. If no two boxes intersect, every label
 * renders as-is. Otherwise a greedy pass in priority order keeps the winner of each collision and
 * drops the rest — no nudging, so placement stays predictable.
 */
function resolveOverlaps(candidates: LabelCandidate[]): LabelCandidate[] {
	if (!hasAnyOverlap(candidates)) {
		return candidates;
	}
	const ordered = [...candidates].sort(byLabelPriority);
	const kept: LabelCandidate[] = [];
	for (const candidate of ordered) {
		if (!kept.some((other) => boxesOverlap(other.box, candidate.box))) {
			kept.push(candidate);
		}
	}
	return kept;
}

function hasAnyOverlap(candidates: LabelCandidate[]): boolean {
	for (let i = 0; i < candidates.length; i += 1) {
		for (let j = i + 1; j < candidates.length; j += 1) {
			if (boxesOverlap(candidates[i].box, candidates[j].box)) {
				return true;
			}
		}
	}
	return false;
}

/** Extremum beats non-extremum; then earlier series wins; then left-to-right for a stable tiebreak. */
function byLabelPriority(a: LabelCandidate, b: LabelCandidate): number {
	if (a.isExtremum !== b.isExtremum) {
		return a.isExtremum ? -1 : 1;
	}
	if (a.seriesIndex !== b.seriesIndex) {
		return a.seriesIndex - b.seriesIndex;
	}
	return a.cx - b.cx;
}

function fitsHorizontally(cx: number, halfWidth: number, plot: PlotRect): boolean {
	const box = labelBox(cx, 0, halfWidth);
	const minLeft = plot.left ?? Number.NEGATIVE_INFINITY;
	const maxRight = plot.left != null && plot.width != null ? plot.left + plot.width : Number.POSITIVE_INFINITY;
	return box.left >= minLeft && box.right <= maxRight;
}

function fitsVertically(box: LabelBox, plot: PlotRect): boolean {
	// Labels for the tallest bars/peaks live in the top headroom reserved above the plot; allow that
	// band (never past the SVG top), but keep labels out of the x-axis area below the plot.
	const minTop = plot.top != null ? Math.max(0, plot.top - DATA_LABEL_MARGIN_TOP) : Number.NEGATIVE_INFINITY;
	const maxBottom = plot.top != null && plot.height != null ? plot.top + plot.height : Number.POSITIVE_INFINITY;
	return box.top >= minTop && box.bottom <= maxBottom;
}

function labelBox(cx: number, baselineY: number, halfWidth: number): LabelBox {
	return {
		left: cx - halfWidth - DATA_LABEL_BOX_PADDING,
		right: cx + halfWidth + DATA_LABEL_BOX_PADDING,
		top: baselineY - DATA_LABEL_FONT_SIZE - DATA_LABEL_BOX_PADDING,
		bottom: baselineY + DATA_LABEL_BOX_PADDING,
	};
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getDataLabelSetup(props: ResolvedProps, isStacked: boolean) {
	const renderedSeries = getRenderedSeries(isStacked, props.series);
	const stackTotalLayer =
		props.showDataLabels && isStacked && renderedSeries.length > 0
			? renderStackTotalLabelsLayer(props.data, props.series)
			: undefined;
	return { renderedSeries, stackTotalLayer };
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
