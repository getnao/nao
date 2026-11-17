import { useState } from 'react';

import type { TestModelColor } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

const WIDTH = 560;
const HEIGHT = 300;
const MARGIN = { left: 44, right: 28, top: 24, bottom: 36 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TARGET_X_TICKS = 5;
/** Rough width of a character of the 11.5px labels, to keep them from overlapping. */
const LABEL_CHAR_WIDTH = 6.4;
const LABEL_HEIGHT = 14;
const POINT_RADIUS = 7;
const BETTER_HINT = 'better ↗';
const BETTER_HINT_POSITION = { x: WIDTH - MARGIN.right - 2, y: MARGIN.top + 12 };
/** Spacing of the boxes that keep labels off a line, small enough that no label slips between two of them. */
const LINE_SAMPLE_SPACING = 6;
const LINE_SAMPLE_RADIUS = 2;

type LabelPlacement = { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' };

/** Where a label may go around its point, in order of preference. */
const LABEL_PLACEMENTS: LabelPlacement[] = [
	{ dx: 10, dy: 4, anchor: 'start' },
	{ dx: -10, dy: 4, anchor: 'end' },
	{ dx: 0, dy: -11, anchor: 'middle' },
	{ dx: 0, dy: 19, anchor: 'middle' },
];

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface TradeoffPoint {
	x: number;
	/** Accuracy, from 0 to 1. */
	y: number;
	/** What the point stands for within its series, such as the reasoning effort the model ran at. */
	label?: string;
}

interface HoveredPoint {
	key: string;
	point: TradeoffPoint;
}

export interface TradeoffSeries {
	key: string;
	label: string;
	color: TestModelColor;
	/** Where the model was before, on production, or null when the run has nothing to compare it with. */
	before: TradeoffPoint | null;
	after: TradeoffPoint;
	/** Points joined by a line through `after`, such as the model at each of its reasoning efforts. */
	line?: TradeoffPoint[];
	change: string | null;
	/** Lines of the tooltip shown on hover of a point without a label of its own. */
	details?: string[];
}

interface TestTradeoffChartProps {
	series: TradeoffSeries[];
	xLabel: string;
	formatX: (value: number) => string;
	ariaLabel: string;
}

/**
 * Accuracy against a cost-like metric, with the x axis reversed so that up and right is better. A model that changed
 * is an arrow from its production point (hollow) to its point with the user's changes (filled), and a model tried at
 * several reasoning efforts is a line through them.
 */
export function TestTradeoffChart({ series, xLabel, formatX, ariaLabel }: TestTradeoffChartProps) {
	const [hovered, setHovered] = useState<HoveredPoint | null>(null);
	const points = series.flatMap(listPoints);
	const xStep = niceStep(Math.max(...points.map((point) => point.x), 0) / TARGET_X_TICKS);
	const xMax = Math.ceil((Math.max(...points.map((point) => point.x), 0) * 1.05) / xStep) * xStep || xStep;
	const yMin = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y), 1) * 10 - 1) / 10);
	const scale = {
		x: (value: number) => MARGIN.left + ((xMax - value) / (xMax || 1)) * PLOT_WIDTH,
		y: (value: number) => MARGIN.top + ((1 - value) / (1 - yMin || 1)) * PLOT_HEIGHT,
	};
	const hoveredSeries = hovered && series.find((entry) => entry.key === hovered.key);
	const placements = placeLabels(series, scale);

	return (
		<div className='relative w-full max-w-[560px]'>
			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				className='h-auto w-full font-sans'
				role='img'
				aria-label={ariaLabel}
				onMouseLeave={() => setHovered(null)}
			>
				<Axes xMax={xMax} xStep={xStep} yMin={yMin} scale={scale} formatX={formatX} xLabel={xLabel} />
				{series.map((entry, index) => (
					<SeriesMarks
						key={entry.key}
						series={entry}
						scale={scale}
						labelPlacement={placements[index]}
						isDimmed={hovered !== null && hovered.key !== entry.key}
						onHoverPoint={(point) => setHovered({ key: entry.key, point })}
					/>
				))}
				{hovered && hoveredSeries && (
					<PointGuides point={hovered.point} color={hoveredSeries.color} scale={scale} formatX={formatX} />
				)}
			</svg>
			{hovered && hoveredSeries && (
				<ChartTooltip
					series={hoveredSeries}
					point={hovered.point}
					left={scale.x(hovered.point.x)}
					top={scale.y(hovered.point.y)}
				/>
			)}
		</div>
	);
}

interface ChartScale {
	x: (value: number) => number;
	y: (value: number) => number;
}

function Axes({
	xMax,
	xStep,
	yMin,
	scale,
	formatX,
	xLabel,
}: {
	xMax: number;
	xStep: number;
	yMin: number;
	scale: ChartScale;
	formatX: (value: number) => string;
	xLabel: string;
}) {
	const yTicks = Array.from({ length: Math.round((1 - yMin) * 10) + 1 }, (_, index) => yMin + index / 10);
	const xTicks = Array.from({ length: Math.round(xMax / xStep) + 1 }, (_, index) => xMax - index * xStep);
	return (
		<g className='fill-muted-foreground text-[11px]'>
			{yTicks.map((tick) => (
				<g key={`y-${tick}`}>
					<line
						x1={MARGIN.left}
						x2={WIDTH - MARGIN.right}
						y1={scale.y(tick)}
						y2={scale.y(tick)}
						className='stroke-border'
					/>
					<text x={MARGIN.left - 8} y={scale.y(tick) + 4} textAnchor='end'>
						{Math.round(tick * 100)}%
					</text>
				</g>
			))}
			{xTicks.map((tick) => (
				<text key={`x-${tick}`} x={scale.x(tick)} y={MARGIN.top + PLOT_HEIGHT + 16} textAnchor='middle'>
					{formatX(tick)}
				</text>
			))}
			<text x={MARGIN.left + PLOT_WIDTH / 2} y={HEIGHT - 2} textAnchor='middle'>
				{xLabel}
			</text>
			<text x={BETTER_HINT_POSITION.x} y={BETTER_HINT_POSITION.y} textAnchor='end' className='opacity-70'>
				{BETTER_HINT}
			</text>
		</g>
	);
}

function SeriesMarks({
	series,
	scale,
	labelPlacement,
	isDimmed,
	onHoverPoint,
}: {
	series: TradeoffSeries;
	scale: ChartScale;
	labelPlacement: LabelPlacement;
	isDimmed: boolean;
	onHoverPoint: (point: TradeoffPoint) => void;
}) {
	const after = { x: scale.x(series.after.x), y: scale.y(series.after.y) };
	const before = series.before ? { x: scale.x(series.before.x), y: scale.y(series.before.y) } : null;
	const line = series.line?.map((point) => ({ x: scale.x(point.x), y: scale.y(point.y) })) ?? [];
	return (
		<g className={cn('transition-opacity', isDimmed && 'opacity-30')}>
			{line.length > 1 && (
				<polyline
					points={line.map((point) => `${point.x},${point.y}`).join(' ')}
					fill='none'
					strokeWidth={1.5}
					strokeLinejoin='round'
					className={series.color.stroke}
				/>
			)}
			{line.map((point, index) => (
				<g key={`${point.x},${point.y}`}>
					<circle cx={point.x} cy={point.y} r={3.5} className={series.color.fill} />
					<circle
						cx={point.x}
						cy={point.y}
						r={10}
						className='fill-transparent'
						onMouseEnter={() => series.line && onHoverPoint(series.line[index])}
					/>
				</g>
			))}
			{before && <Arrow from={before} to={after} color={series.color} />}
			{before && series.before && (
				<circle
					cx={before.x}
					cy={before.y}
					r={4.5}
					strokeWidth={2}
					className={cn('fill-background', series.color.stroke)}
					onMouseEnter={() => series.before && onHoverPoint(series.before)}
				/>
			)}
			<circle
				cx={after.x}
				cy={after.y}
				r={5.5}
				strokeWidth={2}
				className={cn('stroke-background', series.color.fill)}
			/>
			<circle
				cx={after.x}
				cy={after.y}
				r={line.length > 1 ? 10 : 14}
				className='fill-transparent'
				onMouseEnter={() => onHoverPoint(series.after)}
			/>
			<text
				onMouseEnter={() => onHoverPoint(series.after)}
				x={after.x + labelPlacement.dx}
				y={after.y + labelPlacement.dy}
				textAnchor={labelPlacement.anchor}
				className='fill-foreground text-[11.5px] font-medium'
			>
				{series.label}
				{series.change && <tspan className='fill-muted-foreground font-normal'> {series.change}</tspan>}
			</text>
		</g>
	);
}

/** A line from the production point to the point with the user's changes, ending in a head before the filled dot. */
function Arrow({
	from,
	to,
	color,
}: {
	from: { x: number; y: number };
	to: { x: number; y: number };
	color: TestModelColor;
}) {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length < 14) {
		return null;
	}
	const unit = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
	const tip = { x: to.x - unit.x * 8, y: to.y - unit.y * 8 };
	const base = { x: tip.x - unit.x * 7, y: tip.y - unit.y * 7 };
	const normal = { x: -unit.y * 4, y: unit.x * 4 };
	return (
		<g>
			<line
				x1={from.x + unit.x * 6}
				y1={from.y + unit.y * 6}
				x2={base.x}
				y2={base.y}
				strokeWidth={2}
				className={color.stroke}
			/>
			<path
				d={`M${tip.x},${tip.y} L${base.x + normal.x},${base.y + normal.y} L${base.x - normal.x},${base.y - normal.y} Z`}
				className={color.fill}
			/>
		</g>
	);
}

/**
 * Dashed guides from a hovered point to both axes, ending on its exact values, which hide the ticks they land on.
 */
function PointGuides({
	point,
	color,
	scale,
	formatX,
}: {
	point: TradeoffPoint;
	color: TestModelColor;
	scale: ChartScale;
	formatX: (value: number) => string;
}) {
	const x = scale.x(point.x);
	const y = scale.y(point.y);
	const bottom = MARGIN.top + PLOT_HEIGHT;
	const yValue = `${Number((point.y * 100).toFixed(1))}%`;
	const xValue = formatX(point.x);
	return (
		<g className='pointer-events-none text-[11px] font-medium'>
			<line x1={MARGIN.left} x2={x} y1={y} y2={y} strokeDasharray='3 3' className={color.stroke} />
			<line x1={x} x2={x} y1={y} y2={bottom} strokeDasharray='3 3' className={color.stroke} />
			<AxisValue x={MARGIN.left - 8} y={y + 4} anchor='end' text={yValue} color={color} />
			<AxisValue x={x} y={bottom + 16} anchor='middle' text={xValue} color={color} />
		</g>
	);
}

function AxisValue({
	x,
	y,
	anchor,
	text,
	color,
}: {
	x: number;
	y: number;
	anchor: 'end' | 'middle';
	text: string;
	color: TestModelColor;
}) {
	const width = text.length * LABEL_CHAR_WIDTH + 6;
	const left = anchor === 'end' ? x - width + 3 : x - width / 2;
	return (
		<g>
			<rect
				x={left}
				y={y - LABEL_HEIGHT + 3}
				width={width}
				height={LABEL_HEIGHT + 1}
				className='fill-background'
			/>
			<text x={x} y={y} textAnchor={anchor} className={color.fill}>
				{text}
			</text>
		</g>
	);
}

function ChartTooltip({
	series,
	point,
	left,
	top,
}: {
	series: TradeoffSeries;
	point: TradeoffPoint;
	left: number;
	top: number;
}) {
	const isOnLeft = left > WIDTH / 2;
	const lines = point.label ? [point.label] : (series.details ?? []);
	return (
		<div
			className='pointer-events-none absolute z-10 w-max max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md'
			style={{
				left: `${(left / WIDTH) * 100}%`,
				top: `${(top / HEIGHT) * 100}%`,
				transform: `translate(${isOnLeft ? 'calc(-100% - 12px)' : '12px'}, calc(-100% - 6px))`,
			}}
		>
			<div className='flex items-center gap-1.5 font-medium'>
				<span className={cn('size-2 rounded-full', series.color.background)} />
				{series.label}
			</div>
			{lines.map((line) => (
				<div key={line} className='pl-3.5 text-muted-foreground'>
					{line}
				</div>
			))}
		</div>
	);
}

/**
 * Puts each label on the first side of its point where it overlaps no point, no label placed before it, and stays
 * inside the chart; a label that fits nowhere takes the side that overlaps least.
 */
function placeLabels(series: TradeoffSeries[], scale: ChartScale): LabelPlacement[] {
	const pointBoxes = series.flatMap((entry) => [
		...listPoints(entry).map((point) => boxAround(scale.x(point.x), scale.y(point.y), POINT_RADIUS)),
		...sampleLine((entry.line ?? []).map((point) => ({ x: scale.x(point.x), y: scale.y(point.y) }))).map((point) =>
			boxAround(point.x, point.y, LINE_SAMPLE_RADIUS),
		),
	]);
	const labelBoxes: Box[] = [
		labelBox(BETTER_HINT_POSITION.x, BETTER_HINT_POSITION.y, BETTER_HINT.length * LABEL_CHAR_WIDTH, 'end'),
	];
	return series.map((entry) => {
		const x = scale.x(entry.after.x);
		const y = scale.y(entry.after.y);
		const width = (entry.label.length + (entry.change ? entry.change.length + 1 : 0)) * LABEL_CHAR_WIDTH;
		const candidates = LABEL_PLACEMENTS.map((placement) => {
			const box = labelBox(x + placement.dx, y + placement.dy, width, placement.anchor);
			const overlap = [...pointBoxes, ...labelBoxes].reduce((sum, other) => sum + overlapArea(box, other), 0);
			return { placement, box, overlap: isInsidePlot(box) ? overlap : Number.POSITIVE_INFINITY };
		});
		const best =
			candidates.find((candidate) => candidate.overlap === 0) ??
			[...candidates].sort((left, right) => left.overlap - right.overlap)[0];
		labelBoxes.push(best.box);
		return best.placement;
	});
}

/** Points along each segment of a line drawn on the chart, so that labels can stay off it. */
function sampleLine(points: { x: number; y: number }[]): { x: number; y: number }[] {
	return points.slice(1).flatMap((to, index) => {
		const from = points[index];
		const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / LINE_SAMPLE_SPACING);
		return Array.from({ length: steps }, (_, step) => ({
			x: from.x + ((to.x - from.x) * step) / steps,
			y: from.y + ((to.y - from.y) * step) / steps,
		}));
	});
}

function listPoints(series: TradeoffSeries): TradeoffPoint[] {
	return [...(series.before ? [series.before] : []), series.after, ...(series.line ?? [])];
}

function labelBox(x: number, baseline: number, width: number, anchor: LabelPlacement['anchor']): Box {
	const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
	return { left, right: left + width, top: baseline - LABEL_HEIGHT + 3, bottom: baseline + 3 };
}

function boxAround(x: number, y: number, radius: number): Box {
	return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
}

function overlapArea(box: Box, other: Box): number {
	const width = Math.min(box.right, other.right) - Math.max(box.left, other.left);
	const height = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
	return width > 0 && height > 0 ? width * height : 0;
}

function isInsidePlot(box: Box): boolean {
	return (
		box.left >= MARGIN.left &&
		box.right <= WIDTH - MARGIN.right &&
		box.top >= 0 &&
		box.bottom <= MARGIN.top + PLOT_HEIGHT
	);
}

/** A tick step of 1, 2, 2.5 or 5 times a power of ten, so that the axis reads well. */
function niceStep(roughStep: number): number {
	if (roughStep <= 0) {
		return 1;
	}
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const multiplier = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= roughStep) ?? 10;
	return multiplier * magnitude;
}
