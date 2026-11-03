import { useState } from 'react';

import type { TestModelColor } from '@/components/settings/test-run-types';
import { cn } from '@/lib/utils';

const WIDTH = 560;
const HEIGHT = 300;
const MARGIN = { left: 44, right: 28, top: 14, bottom: 36 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TARGET_X_TICKS = 5;
/** Rough width of a character of the 11.5px labels, to keep them from overlapping. */
const LABEL_CHAR_WIDTH = 6.4;
const LABEL_HEIGHT = 14;
const POINT_RADIUS = 7;

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

interface TradeoffPoint {
	x: number;
	/** Accuracy, from 0 to 1. */
	y: number;
}

export interface TradeoffSeries {
	key: string;
	label: string;
	color: TestModelColor;
	/** Where the model was before, on production, or null when the run has nothing to compare it with. */
	before: TradeoffPoint | null;
	after: TradeoffPoint;
	/** Says what changed, next to the label. */
	change: string | null;
	/** Lines of the tooltip shown on hover. */
	details: string[];
}

interface TestTradeoffChartProps {
	series: TradeoffSeries[];
	xLabel: string;
	formatX: (value: number) => string;
	ariaLabel: string;
}

/**
 * Accuracy against a cost-like metric, with the x axis reversed so that up and right is better. A model that changed
 * is an arrow from its production point (hollow) to its point with the user's changes (filled).
 */
export function TestTradeoffChart({ series, xLabel, formatX, ariaLabel }: TestTradeoffChartProps) {
	const [hoveredKey, setHoveredKey] = useState<string | null>(null);
	const points = series.flatMap((entry) => (entry.before ? [entry.before, entry.after] : [entry.after]));
	const xStep = niceStep(Math.max(...points.map((point) => point.x), 0) / TARGET_X_TICKS);
	const xMax = Math.ceil((Math.max(...points.map((point) => point.x), 0) * 1.05) / xStep) * xStep || xStep;
	const yMin = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y), 1) * 10 - 1) / 10);
	const scale = {
		x: (value: number) => MARGIN.left + ((xMax - value) / (xMax || 1)) * PLOT_WIDTH,
		y: (value: number) => MARGIN.top + ((1 - value) / (1 - yMin || 1)) * PLOT_HEIGHT,
	};
	const hovered = series.find((entry) => entry.key === hoveredKey);
	const placements = placeLabels(series, scale);

	return (
		<div className='relative'>
			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				className='h-auto w-full font-sans'
				role='img'
				aria-label={ariaLabel}
				onMouseLeave={() => setHoveredKey(null)}
			>
				<Axes xMax={xMax} xStep={xStep} yMin={yMin} scale={scale} formatX={formatX} xLabel={xLabel} />
				{series.map((entry, index) => (
					<SeriesMarks
						key={entry.key}
						series={entry}
						scale={scale}
						labelPlacement={placements[index]}
						isDimmed={hoveredKey !== null && hoveredKey !== entry.key}
						onHover={() => setHoveredKey(entry.key)}
					/>
				))}
			</svg>
			{hovered && (
				<ChartTooltip series={hovered} left={scale.x(hovered.after.x)} top={scale.y(hovered.after.y)} />
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
			<text x={WIDTH - MARGIN.right - 2} y={MARGIN.top + 12} textAnchor='end' className='opacity-70'>
				better ↗
			</text>
		</g>
	);
}

function SeriesMarks({
	series,
	scale,
	labelPlacement,
	isDimmed,
	onHover,
}: {
	series: TradeoffSeries;
	scale: ChartScale;
	labelPlacement: LabelPlacement;
	isDimmed: boolean;
	onHover: () => void;
}) {
	const after = { x: scale.x(series.after.x), y: scale.y(series.after.y) };
	const before = series.before ? { x: scale.x(series.before.x), y: scale.y(series.before.y) } : null;
	return (
		<g className={cn('transition-opacity', isDimmed && 'opacity-30')} onMouseEnter={onHover}>
			{before && <Arrow from={before} to={after} color={series.color} />}
			{before && (
				<circle
					cx={before.x}
					cy={before.y}
					r={4.5}
					strokeWidth={2}
					className={cn('fill-background', series.color.stroke)}
				/>
			)}
			<circle
				cx={after.x}
				cy={after.y}
				r={5.5}
				strokeWidth={2}
				className={cn('stroke-background', series.color.fill)}
			/>
			<circle cx={after.x} cy={after.y} r={14} className='fill-transparent' />
			<text
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

function ChartTooltip({ series, left, top }: { series: TradeoffSeries; left: number; top: number }) {
	const isOnLeft = left > WIDTH / 2;
	return (
		<div
			className='pointer-events-none absolute z-10 w-56 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md'
			style={{
				left: `${(left / WIDTH) * 100}%`,
				top: `${(top / HEIGHT) * 100}%`,
				transform: `translate(${isOnLeft ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
			}}
		>
			<div className='flex items-center gap-1.5 font-medium'>
				<span className={cn('size-2 rounded-full', series.color.background)} />
				{series.label}
			</div>
			{series.details.map((line) => (
				<div key={line} className='text-muted-foreground'>
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
	const pointBoxes = series.flatMap((entry) =>
		(entry.before ? [entry.before, entry.after] : [entry.after]).map((point) =>
			boxAround(scale.x(point.x), scale.y(point.y), POINT_RADIUS),
		),
	);
	const labelBoxes: Box[] = [];
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
