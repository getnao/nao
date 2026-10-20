import { type Rgb, wcagContrast } from 'culori';
import React, { useLayoutEffect, useRef, useState } from 'react';

import type { GraphicalItem, LabelBox, LabelTextAnchor } from './chart-data-labels';
import { toFiniteNumber } from './chart-values';
import { parseCssColor } from './color';

const LIGHT_INK = '#ffffff';
const DARK_INK = '#111827';
const PLOT_INK = 'var(--foreground, #111827)';
const HALO_WIDTH = 3;
const STICKER_HALO_WIDTH = 4;
/** Share of a label box a single fill must cover before the label adopts that fill's contrast. */
const FILL_COVERAGE_THRESHOLD = 0.6;
/** Below this total fill coverage the label is treated as sitting on the plot background. */
const PLOT_COVERAGE_THRESHOLD = 0.15;

export interface FillRegion extends LabelBox {
	fill: string;
}

export type LabelBackdrop = { kind: 'plot' } | { kind: 'mixed' } | { kind: 'fill'; fill: string };

export interface LabelPaint {
	fill: string;
	stroke: string;
	strokeWidth: number;
}

export interface PaintableLabel {
	cx: number;
	baselineY: number;
	box: LabelBox;
	text: string;
	textAnchor: LabelTextAnchor;
}

interface ContrastAwareLabelsProps {
	labels: PaintableLabel[];
	regions: FillRegion[];
	backgroundColor: string;
	textProps: React.SVGProps<SVGTextElement>;
}

type ColorResolver = (color: string) => Rgb | null;

/**
 * Renders data labels in place, picking ink and halo per label from what is drawn beneath it so text
 * stays readable on bars, across bar edges and over lines or gridlines.
 */
export function ContrastAwareLabels({ labels, regions, backgroundColor, textProps }: ContrastAwareLabelsProps) {
	const groupRef = useRef<SVGGElement>(null);
	const backdrops = labels.map((label) => labelBackdrop(label.box, regions));
	const resolveColor = useCssColorResolver(groupRef, backdropFills(backdrops));
	return (
		<g ref={groupRef} className='recharts-data-labels'>
			{labels.map((label, index) => {
				const paint = labelPaint(backdrops[index], resolveColor, backgroundColor);
				return (
					<text
						key={index}
						x={label.cx}
						y={label.baselineY}
						textAnchor={label.textAnchor}
						dominantBaseline='alphabetic'
						{...textProps}
						fill={paint.fill}
						stroke={paint.stroke}
						strokeWidth={paint.strokeWidth}
						strokeLinejoin='round'
						paintOrder='stroke'
					>
						{label.text}
					</text>
				);
			})}
		</g>
	);
}

export function collectFillRegions(items: GraphicalItem[]): FillRegion[] {
	return items.flatMap((entry) => {
		if (entry.item?.type?.displayName !== 'Bar') {
			return [];
		}
		const fill = entry.item.props?.fill ?? entry.props?.fill;
		if (typeof fill !== 'string') {
			return [];
		}
		return (entry.props?.data ?? []).flatMap((point) => {
			const region = pointRegion(point, fill);
			return region ? [region] : [];
		});
	});
}

export function labelBackdrop(box: LabelBox, regions: FillRegion[]): LabelBackdrop {
	const boxArea = regionArea(box);
	if (boxArea <= 0) {
		return { kind: 'plot' };
	}
	const coverageByFill = new Map<string, number>();
	for (const region of regions) {
		const overlap = intersectionArea(box, region);
		if (overlap > 0) {
			coverageByFill.set(region.fill, (coverageByFill.get(region.fill) ?? 0) + overlap / boxArea);
		}
	}
	const coverages = [...coverageByFill.entries()];
	const totalCoverage = coverages.reduce((sum, [, coverage]) => sum + coverage, 0);
	if (totalCoverage <= PLOT_COVERAGE_THRESHOLD) {
		return { kind: 'plot' };
	}
	const [dominantFill, dominantCoverage] = coverages.reduce((best, current) =>
		current[1] > best[1] ? current : best,
	);
	return dominantCoverage >= FILL_COVERAGE_THRESHOLD ? { kind: 'fill', fill: dominantFill } : { kind: 'mixed' };
}

/**
 * On a fill the ink is whichever of light/dark contrasts more, haloed in the fill itself so lines crossing
 * the label are masked. Elsewhere the theme ink keeps a background halo, widened when the label straddles
 * a fill edge so it reads like a sticker on either side.
 */
export function labelPaint(backdrop: LabelBackdrop, resolveColor: ColorResolver, backgroundColor: string): LabelPaint {
	if (backdrop.kind === 'fill') {
		const surface = resolveColor(backdrop.fill);
		if (surface) {
			return { fill: readableInkOn(surface), stroke: backdrop.fill, strokeWidth: HALO_WIDTH };
		}
	}
	return {
		fill: PLOT_INK,
		stroke: backgroundColor,
		strokeWidth: backdrop.kind === 'plot' ? HALO_WIDTH : STICKER_HALO_WIDTH,
	};
}

export function readableInkOn(surface: Rgb): string {
	return wcagContrast(LIGHT_INK, surface) >= wcagContrast(DARK_INK, surface) ? LIGHT_INK : DARK_INK;
}

/**
 * Series fills are often scoped CSS variables (`var(--color-revenue)`) that only resolve inside the chart's
 * DOM, so unresolved colours are read back through computed style before paint. Concrete colours (backend
 * exports) resolve synchronously and need no DOM.
 */
function useCssColorResolver(elementRef: React.RefObject<SVGGElement | null>, colors: string[]): ColorResolver {
	const [computedColors, setComputedColors] = useState<Record<string, string>>({});
	const unresolvedKey = colors.filter((color) => !parseCssColor(color)).join('\n');

	useLayoutEffect(() => {
		const element = elementRef.current;
		if (!element || !unresolvedKey) {
			return;
		}
		const next = computeColorsThroughDom(element, unresolvedKey.split('\n'));
		setComputedColors((current) => (sameColors(current, next) ? current : next));
	}, [elementRef, unresolvedKey]);

	return (color) => {
		const computed = computedColors[color];
		return parseCssColor(color) ?? (computed ? parseCssColor(computed) : null);
	};
}

function computeColorsThroughDom(element: SVGGElement, colors: string[]): Record<string, string> {
	const previous = element.style.color;
	const computed: Record<string, string> = {};
	for (const color of colors) {
		element.style.color = color;
		computed[color] = getComputedStyle(element).color;
	}
	element.style.color = previous;
	return computed;
}

function sameColors(a: Record<string, string>, b: Record<string, string>): boolean {
	const keys = Object.keys(b);
	return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key]);
}

function backdropFills(backdrops: LabelBackdrop[]): string[] {
	const fills = backdrops.flatMap((backdrop) => (backdrop.kind === 'fill' ? [backdrop.fill] : []));
	return [...new Set(fills)].sort();
}

function pointRegion(
	point: { x?: number; y?: number; width?: number; height?: number },
	fill: string,
): FillRegion | null {
	const x = toFiniteNumber(point.x);
	const y = toFiniteNumber(point.y);
	const width = toFiniteNumber(point.width);
	const height = toFiniteNumber(point.height);
	if (x == null || y == null || width == null || height == null || width === 0 || height === 0) {
		return null;
	}
	return {
		left: Math.min(x, x + width),
		right: Math.max(x, x + width),
		top: Math.min(y, y + height),
		bottom: Math.max(y, y + height),
		fill,
	};
}

function intersectionArea(a: LabelBox, b: LabelBox): number {
	const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
	const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
	return width > 0 && height > 0 ? width * height : 0;
}

function regionArea(box: LabelBox): number {
	return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}
