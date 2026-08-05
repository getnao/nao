import React from 'react';

import { barYAxisDomainIsPadded, collectAxisValues, collectStackedAxisValues } from './chart-domain';
import { formatChartValue, getChartLevelValueFormat, niceAxisMax, toFiniteNumber } from './chart-values';
import * as displayChart from './tools/display-chart';

const DATA_LABEL_PROPS = {
	fill: 'var(--foreground, #111827)',
	fontSize: 11,
	fontFamily: 'system-ui, sans-serif',
};
export const DATA_LABEL_MARGIN_TOP = 24;
export const DATA_LABEL_X_AXIS_FOOTROOM = 24;
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
const MAX_SERIES_DATA_LABELS = 12;
export const PIE_LABELLED_OUTER_RADIUS = '65%';
const PIE_DATA_LABEL_GAP = 10;

interface DataLabelChartProps {
	data: Record<string, unknown>[];
	series: displayChart.SeriesConfig[];
	chartType: displayChart.ChartType;
	showDataLabels?: boolean;
	yAxisMin?: number;
	yAxisMax?: number;
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

interface PieSector {
	cx?: number;
	cy?: number;
	innerRadius?: number;
	outerRadius?: number;
	midAngle?: number;
	percent?: number;
	value?: unknown;
}

interface GraphicalItem {
	item?: { type?: { displayName?: string }; props?: { dataKey?: unknown } };
	props?: { points?: GraphicalPoint[]; data?: GraphicalPoint[]; sectors?: PieSector[]; dataKey?: unknown };
}

interface DataLabelsLayerProps {
	formattedGraphicalItems?: GraphicalItem[];
	offset?: PlotRect;
	width?: number;
	height?: number;
}

interface LabelCandidate {
	cx: number;
	baselineY: number;
	box: LabelBox;
	text: string;
	rank: number[];
	textAnchor: 'start' | 'middle' | 'end';
}

interface IndexedLabelCandidate {
	candidate: LabelCandidate;
	index: number;
	value: number;
}

interface LabelBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface LabelCandidateOptions {
	bounds: LabelBox;
	textAnchor?: LabelCandidate['textAnchor'];
}

type LabelsCollector = (props: DataLabelsLayerProps) => LabelCandidate[];

export function formatDataLabel(value: unknown, valueFormat?: displayChart.ValueFormat): string {
	const number = toFiniteNumber(value);
	return number == null ? '' : formatChartValue(number, valueFormat, { compact: true });
}

export function shouldReserveDataLabelHeadroom<Props extends DataLabelChartProps>(props: Props): boolean {
	if (props.showDataLabels !== true || !isCartesianLabelChart(props.chartType)) {
		return false;
	}
	if (barChartUsesPaddedDomain(props)) {
		return false;
	}
	if (displayChart.isStackedChartType(props.chartType)) {
		return true;
	}
	const maxValue = getMaxPlottedValue(props);
	if (maxValue == null || maxValue <= 0) {
		return false;
	}
	return maxValue >= niceAxisMax(maxValue) * DATA_LABEL_HEADROOM_RATIO;
}

export function shouldReserveStackTotalFootroom<Props extends DataLabelChartProps>(props: Props): boolean {
	if (props.showDataLabels !== true || !displayChart.isStackedChartType(props.chartType)) {
		return false;
	}
	if (displayChart.isPercentStackedChartType(props.chartType)) {
		return false;
	}
	return props.data.some((row) => {
		const total = sumStackValue(row, props.series);
		return total != null && total < 0;
	});
}

/** Coordinates cartesian labels across series so conflicts can be dropped without moving labels. */
export function renderDataLabelsLayer(series: displayChart.SeriesConfig[]) {
	return createLabelsLayer('DataLabelsLayer', ({ formattedGraphicalItems, offset, width, height }) =>
		collectLabelCandidates(formattedGraphicalItems ?? [], offset ?? {}, width, height, series),
	);
}

export function renderStackTotalLabelsLayer(data: Record<string, unknown>[], series: displayChart.SeriesConfig[]) {
	const valueFormat = getChartLevelValueFormat(series);
	return createLabelsLayer('StackTotalLabelsLayer', ({ formattedGraphicalItems, offset, width, height }) => {
		const items = (formattedGraphicalItems ?? []).filter((entry) =>
			LABELLED_SERIES_KINDS.has(entry.item?.type?.displayName ?? ''),
		);
		const kind = items[0]?.item?.type?.displayName;
		return kind
			? stackTotalCandidates(items, data, series, kind === 'Bar', offset ?? {}, width, height, valueFormat)
			: [];
	});
}

export function renderPieDataLabelsLayer(valueFormat?: displayChart.ValueFormat) {
	return createLabelsLayer('PieDataLabelsLayer', ({ formattedGraphicalItems, width, height }) => {
		const pie = (formattedGraphicalItems ?? []).find((entry) => entry.item?.type?.displayName === 'Pie');
		return collectPieLabelCandidates(pie?.props?.sectors ?? [], width, height, valueFormat);
	});
}

export function getDataLabelSetup<Props extends Pick<DataLabelChartProps, 'data' | 'series' | 'showDataLabels'>>(
	props: Props,
	isStacked: boolean,
) {
	const renderedSeries = getRenderedSeries(props.series, isStacked);
	const stackTotalLayer =
		props.showDataLabels && isStacked && renderedSeries.length > 0
			? renderStackTotalLabelsLayer(props.data, props.series)
			: undefined;
	return { renderedSeries, stackTotalLayer };
}

export function getRenderedSeries(series: displayChart.SeriesConfig[], isStacked: boolean) {
	return isStacked ? series.filter((item) => !item.is_total) : series;
}

function createLabelsLayer(displayName: string, collect: LabelsCollector) {
	function LabelsLayer(props: DataLabelsLayerProps) {
		return renderLabels(resolveLabelOverlaps(collect(props)));
	}
	LabelsLayer.displayName = displayName;
	return LabelsLayer;
}

function renderLabels(labels: LabelCandidate[]) {
	if (labels.length === 0) {
		return null;
	}
	return (
		<g className='recharts-data-labels'>
			{labels.map((label, index) => (
				<text
					key={index}
					x={label.cx}
					y={label.baselineY}
					textAnchor={label.textAnchor}
					dominantBaseline='alphabetic'
					{...DATA_LABEL_PROPS}
				>
					{label.text}
				</text>
			))}
		</g>
	);
}

function isCartesianLabelChart(chartType: displayChart.ChartType): boolean {
	return (
		chartType === 'bar' ||
		chartType === 'line' ||
		chartType === 'area' ||
		displayChart.isStackedChartType(chartType) ||
		chartType === 'mixed'
	);
}

function barChartUsesPaddedDomain(props: DataLabelChartProps): boolean {
	if (props.chartType !== 'bar' && props.chartType !== 'stacked_bar') {
		return false;
	}
	const isStacked = props.chartType === 'stacked_bar';
	const dataKeys = getRenderedSeries(props.series, isStacked).map((series) => series.data_key);
	const axisValues = isStacked
		? collectStackedAxisValues(props.data, dataKeys)
		: collectAxisValues(props.data, dataKeys);
	return barYAxisDomainIsPadded(props.yAxisMax, axisValues, props.showDataLabels === true);
}

function getMaxPlottedValue(props: DataLabelChartProps): number | null {
	const isStacked = displayChart.isStackedChartType(props.chartType);
	let max: number | null = null;
	for (const row of props.data) {
		let positiveStackTotal = 0;
		for (const item of props.series) {
			if (isStacked && item.is_total) {
				continue;
			}
			const value = toFiniteNumber(row[item.data_key]);
			if (isStacked) {
				if (value != null && value > 0) {
					positiveStackTotal += value;
				}
			} else if (value != null && (max == null || value > max)) {
				max = value;
			}
		}
		if (isStacked && positiveStackTotal > 0 && (max == null || positiveStackTotal > max)) {
			max = positiveStackTotal;
		}
	}
	return max;
}

/** A point is a local extremum when its value turns direction — a peak or a trough versus neighbours. */
function isLocalExtremum(values: (number | null)[], index: number): boolean {
	const value = values[index];
	if (value == null) {
		return false;
	}
	const left = values[index - 1] ?? null;
	const right = values[index + 1] ?? null;
	if (left == null) {
		return right == null || value !== right;
	}
	if (right == null) {
		return value !== left;
	}
	const leftDirection = Math.sign(value - left);
	const rightDirection = Math.sign(value - right);
	return leftDirection !== 0 && leftDirection === rightDirection;
}

function stackTotalCandidates(
	items: GraphicalItem[],
	data: Record<string, unknown>[],
	series: displayChart.SeriesConfig[],
	isBar: boolean,
	plot: PlotRect,
	chartWidth: number | undefined,
	chartHeight: number | undefined,
	valueFormat?: displayChart.ValueFormat,
): LabelCandidate[] {
	const totals = data.map((row) => sumStackValue(row, series));

	return totals.flatMap((total, dataIndex) => {
		if (total == null || total === 0) {
			return [];
		}
		const isPositive = total > 0;
		const anchor = stackTotalAnchor(items, dataIndex, isBar, isPositive);
		if (!anchor) {
			return [];
		}
		const baselineY = isPositive
			? anchor.anchorY - DATA_LABEL_ANCHOR_GAP
			: anchor.anchorY + DATA_LABEL_ANCHOR_GAP + DATA_LABEL_FONT_SIZE;
		const candidate = buildLabelCandidate(
			anchor.cx,
			baselineY,
			formatDataLabel(total, valueFormat),
			cartesianLabelRank(isLocalExtremum(totals, dataIndex), 0, anchor.cx),
			{
				bounds: cartesianLabelBounds(
					plot,
					chartWidth,
					chartHeight,
					isPositive ? 0 : DATA_LABEL_X_AXIS_FOOTROOM,
				),
			},
		);
		return candidate ? [candidate] : [];
	});
}

function stackTotalAnchor(
	items: GraphicalItem[],
	dataIndex: number,
	isBar: boolean,
	isPositive: boolean,
): { cx: number; anchorY: number } | null {
	let extreme: { cx: number; anchorY: number } | null = null;
	items.forEach((item) => {
		const points = isBar ? item.props?.data : item.props?.points;
		const point = points?.[dataIndex];
		const value = pointValue(point, 'segment');
		if (value == null || (isPositive ? value <= 0 : value >= 0)) {
			return;
		}
		const anchor = pointEdgeAnchor(point, isBar, isPositive);
		if (!anchor) {
			return;
		}
		if (extreme == null || (isPositive ? anchor.anchorY < extreme.anchorY : anchor.anchorY > extreme.anchorY)) {
			extreme = anchor;
		}
	});
	return extreme;
}

function collectPieLabelCandidates(
	sectors: PieSector[],
	width: number | undefined,
	height: number | undefined,
	valueFormat?: displayChart.ValueFormat,
): LabelCandidate[] {
	if (width == null || height == null) {
		return [];
	}
	return sectors.flatMap((sector, sliceIndex) => {
		const cx = toFiniteNumber(sector.cx);
		const cy = toFiniteNumber(sector.cy);
		const outerRadius = toFiniteNumber(sector.outerRadius);
		const midAngle = toFiniteNumber(sector.midAngle);
		const text = formatDataLabel(sector.value, valueFormat);
		if (cx == null || cy == null || outerRadius == null || midAngle == null || !text) {
			return [];
		}
		const radius = outerRadius + PIE_DATA_LABEL_GAP;
		const angle = (-midAngle * Math.PI) / 180;
		const labelX = cx + radius * Math.cos(angle);
		const baselineY = cy + radius * Math.sin(angle);
		const candidate = buildLabelCandidate(labelX, baselineY, text, [sector.percent ?? 0, -sliceIndex], {
			bounds: { left: 0, right: width, top: 0, bottom: height },
			textAnchor: labelX >= cx ? 'start' : 'end',
		});
		return candidate ? [candidate] : [];
	});
}

function collectLabelCandidates(
	items: GraphicalItem[],
	plot: PlotRect,
	chartWidth: number | undefined,
	chartHeight: number | undefined,
	series: displayChart.SeriesConfig[],
): LabelCandidate[] {
	const graphicalItems = items.filter((entry) => LABELLED_SERIES_KINDS.has(entry.item?.type?.displayName ?? ''));
	return graphicalItems.flatMap((entry, seriesIndex) => {
		const kind = entry.item?.type?.displayName;
		if (!kind) {
			return [];
		}
		const points = kind === 'Bar' ? entry.props?.data : entry.props?.points;
		if (!points || points.length === 0) {
			return [];
		}
		const dataKey = entry.props?.dataKey ?? entry.item?.props?.dataKey;
		const seriesConfig =
			series.find((item) => dataKey != null && item.data_key === String(dataKey)) ?? series[seriesIndex];
		return seriesCandidates(
			points,
			points.map((point) => pointValue(point, 'end')),
			kind === 'Bar',
			seriesIndex,
			plot,
			chartWidth,
			chartHeight,
			seriesConfig?.value_format,
		);
	});
}

function seriesCandidates(
	points: GraphicalPoint[],
	values: (number | null)[],
	isBar: boolean,
	seriesIndex: number,
	plot: PlotRect,
	chartWidth: number | undefined,
	chartHeight: number | undefined,
	valueFormat?: displayChart.ValueFormat,
): LabelCandidate[] {
	const candidates = points.flatMap((point, index): IndexedLabelCandidate[] => {
		const value = values[index];
		if (value == null) {
			return [];
		}
		const text = formatDataLabel(value, valueFormat);
		if (!text) {
			return [];
		}
		const anchor = labelAnchor(point, value, isBar);
		if (anchor == null) {
			return [];
		}
		const candidate = buildLabelCandidate(
			anchor.cx,
			anchor.baselineY,
			text,
			cartesianLabelRank(isLocalExtremum(values, index), seriesIndex, anchor.cx),
			{ bounds: cartesianLabelBounds(plot, chartWidth, chartHeight) },
		);
		return candidate ? [{ candidate, index, value }] : [];
	});
	if (isBar || candidates.length <= MAX_SERIES_DATA_LABELS) {
		return candidates.map((entry) => entry.candidate);
	}
	return selectSeriesLabelCandidates(candidates, values).map((entry) => entry.candidate);
}

function selectSeriesLabelCandidates(
	candidates: IndexedLabelCandidate[],
	values: (number | null)[],
): IndexedLabelCandidate[] {
	const selectedIndices = new Set<number>();
	const minimum = candidates.reduce((best, current) => (current.value < best.value ? current : best));
	const maximum = candidates.reduce((best, current) => (current.value > best.value ? current : best));
	selectedIndices.add(minimum.index);
	selectedIndices.add(maximum.index);

	const remainingSlots = () => MAX_SERIES_DATA_LABELS - selectedIndices.size;
	const extrema = candidates.filter(
		(entry) => !selectedIndices.has(entry.index) && isLocalExtremum(values, entry.index),
	);
	const selectedExtrema =
		extrema.length <= remainingSlots() ? extrema : sampleLabelCandidatesEvenly(extrema, remainingSlots());
	selectedExtrema.forEach((entry) => selectedIndices.add(entry.index));

	const remaining = candidates.filter((entry) => !selectedIndices.has(entry.index));
	sampleLabelCandidatesEvenly(remaining, remainingSlots()).forEach((entry) => selectedIndices.add(entry.index));
	return candidates.filter((entry) => selectedIndices.has(entry.index));
}

function sampleLabelCandidatesEvenly(candidates: IndexedLabelCandidate[], count: number): IndexedLabelCandidate[] {
	if (count <= 0) {
		return [];
	}
	if (candidates.length <= count) {
		return candidates;
	}

	const ordered = [...candidates].sort((a, b) => a.candidate.cx - b.candidate.cx || a.index - b.index);
	const firstX = ordered[0].candidate.cx;
	const lastX = ordered[ordered.length - 1].candidate.cx;
	const selected = new Set<number>();

	for (let position = 0; position < count; position += 1) {
		const fraction = count === 1 ? 0.5 : position / (count - 1);
		const targetX = firstX + (lastX - firstX) * fraction;
		const closest = ordered
			.filter((entry) => !selected.has(entry.index))
			.reduce((best, current) => {
				const currentDistance = Math.abs(current.candidate.cx - targetX);
				const bestDistance = Math.abs(best.candidate.cx - targetX);
				return currentDistance < bestDistance ||
					(currentDistance === bestDistance && current.index < best.index)
					? current
					: best;
			});
		selected.add(closest.index);
	}

	return ordered.filter((entry) => selected.has(entry.index));
}

function buildLabelCandidate(
	cx: number,
	baselineY: number,
	text: string,
	rank: number[],
	options: LabelCandidateOptions,
): LabelCandidate | null {
	const halfWidth = (text.length * DATA_LABEL_FONT_SIZE * DATA_LABEL_CHAR_WIDTH_RATIO) / 2;
	const middleBox = labelBox(cx, baselineY, halfWidth);
	const textAnchor = options.textAnchor ?? selectTextAnchor(middleBox, options.bounds);
	const box = labelBox(cx, baselineY, halfWidth, textAnchor);
	if (!boxFitsBounds(box, options.bounds)) {
		return null;
	}
	return { cx, baselineY, box, text, rank, textAnchor };
}

/** Area/line points carry `value` as a `[baseLine, value]` range; bars carry a scalar. Unwrap both. */
function pointValue(point: GraphicalPoint | undefined, mode: 'end' | 'segment'): number | null {
	if (!Array.isArray(point?.value)) {
		return toFiniteNumber(point?.value);
	}
	const end = toFiniteNumber(point.value[point.value.length - 1]);
	if (mode === 'end') {
		return end;
	}
	if (point.value.length < 2) {
		return null;
	}
	const start = toFiniteNumber(point.value[0]);
	return start == null || end == null ? null : end - start;
}

/** Natural label position: one gap above the point/bar-top (below the bar for negative bars). */
function labelAnchor(point: GraphicalPoint, value: number, isBar: boolean): { cx: number; baselineY: number } | null {
	const isPositive = isBar ? value >= 0 : true;
	const anchor = pointEdgeAnchor(point, isBar, isPositive);
	if (!anchor) {
		return null;
	}
	return {
		cx: anchor.cx,
		baselineY: isPositive
			? anchor.anchorY - DATA_LABEL_ANCHOR_GAP
			: anchor.anchorY + DATA_LABEL_ANCHOR_GAP + DATA_LABEL_FONT_SIZE,
	};
}

function pointEdgeAnchor(
	point: GraphicalPoint | undefined,
	isBar: boolean,
	isPositive: boolean,
): { cx: number; anchorY: number } | null {
	const x = toFiniteNumber(point?.x);
	const y = toFiniteNumber(point?.y);
	if (point == null || x == null || y == null) {
		return null;
	}
	const width = isBar ? (toFiniteNumber(point.width) ?? 0) : 0;
	const otherY = y + (isBar ? (toFiniteNumber(point.height) ?? 0) : 0);
	return {
		cx: x + width / 2,
		anchorY: isPositive ? Math.min(y, otherY) : Math.max(y, otherY),
	};
}

/**
 * Keeps labels at their natural position and drops conflicts. If no two boxes intersect, every label
 * renders as-is. Otherwise a greedy pass in priority order keeps the winner of each collision and
 * drops the rest — no nudging, so placement stays predictable.
 */
function resolveLabelOverlaps(candidates: LabelCandidate[]): LabelCandidate[] {
	const ordered = [...candidates].sort(byLabelRank);
	const kept: LabelCandidate[] = [];
	for (const candidate of ordered) {
		if (!kept.some((other) => boxesOverlap(other.box, candidate.box))) {
			kept.push(candidate);
		}
	}
	return kept.length === candidates.length ? candidates : kept;
}

function byLabelRank(a: LabelCandidate, b: LabelCandidate): number {
	for (let index = 0; index < Math.max(a.rank.length, b.rank.length); index += 1) {
		const difference = (b.rank[index] ?? 0) - (a.rank[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

function cartesianLabelRank(isExtremum: boolean, seriesIndex: number, x: number): number[] {
	return [isExtremum ? 1 : 0, -seriesIndex, -x];
}

function selectTextAnchor(middleBox: LabelBox, bounds: LabelBox): LabelCandidate['textAnchor'] {
	if (middleBox.right > bounds.right) {
		return 'end';
	}
	if (middleBox.left < bounds.left) {
		return 'start';
	}
	return 'middle';
}

function cartesianLabelBounds(
	plot: PlotRect,
	chartWidth: number | undefined,
	chartHeight: number | undefined,
	bottomAllowance = 0,
): LabelBox {
	return {
		left: plot.left ?? 0,
		right: plot.left != null && plot.width != null ? plot.left + plot.width : (chartWidth ?? 0),
		top: plot.top != null ? Math.max(0, plot.top - DATA_LABEL_MARGIN_TOP) : 0,
		bottom: plot.top != null && plot.height != null ? plot.top + plot.height + bottomAllowance : (chartHeight ?? 0),
	};
}

function boxFitsBounds(box: LabelBox, bounds: LabelBox): boolean {
	return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
}

function labelBox(
	cx: number,
	baselineY: number,
	halfWidth: number,
	textAnchor: LabelCandidate['textAnchor'] = 'middle',
): LabelBox {
	const left = textAnchor === 'start' ? cx : textAnchor === 'end' ? cx - halfWidth * 2 : cx - halfWidth;
	const right = textAnchor === 'start' ? cx + halfWidth * 2 : textAnchor === 'end' ? cx : cx + halfWidth;
	return {
		left: left - (textAnchor === 'start' ? 0 : DATA_LABEL_BOX_PADDING),
		right: right + (textAnchor === 'end' ? 0 : DATA_LABEL_BOX_PADDING),
		top: baselineY - DATA_LABEL_FONT_SIZE - DATA_LABEL_BOX_PADDING,
		bottom: baselineY + DATA_LABEL_BOX_PADDING,
	};
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function sumStackValue(row: Record<string, unknown> | undefined, series: displayChart.SeriesConfig[]): number | null {
	if (!row) {
		return null;
	}

	const values = series.filter((s) => !s.is_total).map((s) => toFiniteNumber(row[s.data_key]));
	const numericValues = values.filter((value): value is number => value != null);
	return numericValues.length > 0 ? numericValues.reduce((sum, value) => sum + value, 0) : null;
}
