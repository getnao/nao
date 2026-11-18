import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';
import type { GraphicalItem } from '../src/chart-data-labels';
import { collectFillRegions, labelBackdrop, labelPaint, readableInkOn } from '../src/chart-label-contrast';
import { parseCssColor } from '../src/color';

const BOX = { left: 0, right: 40, top: 0, bottom: 10 };
const BACKGROUND = '#ffffff';

function region(left: number, right: number, fill: string) {
	return { left, right, top: -100, bottom: 100, fill };
}

function rgb(color: string) {
	const parsed = parseCssColor(color);
	if (!parsed) {
		throw new Error(`Unparseable colour ${color}`);
	}
	return parsed;
}

describe('labelBackdrop', () => {
	it('treats a label with no fill beneath it as sitting on the plot', () => {
		expect(labelBackdrop(BOX, [])).toEqual({ kind: 'plot' });
		expect(labelBackdrop(BOX, [region(38, 80, '#4b2ff5')])).toEqual({ kind: 'plot' });
	});

	it('adopts the fill that covers most of the label', () => {
		expect(labelBackdrop(BOX, [region(-10, 50, '#4b2ff5')])).toEqual({ kind: 'fill', fill: '#4b2ff5' });
		expect(labelBackdrop(BOX, [region(-10, 30, '#4b2ff5')])).toEqual({ kind: 'fill', fill: '#4b2ff5' });
	});

	it('reports a mixed backdrop when the label straddles a fill edge', () => {
		expect(labelBackdrop(BOX, [region(20, 80, '#4b2ff5')])).toEqual({ kind: 'mixed' });
		expect(labelBackdrop(BOX, [region(-10, 20, '#4b2ff5'), region(20, 60, '#ffb900')])).toEqual({
			kind: 'mixed',
		});
	});
});

describe('labelPaint', () => {
	it('uses light ink on dark fills and dark ink on light fills, haloed in the fill', () => {
		expect(labelPaint({ kind: 'fill', fill: '#4b2ff5' }, parseCssColor, BACKGROUND)).toEqual({
			fill: '#ffffff',
			stroke: '#4b2ff5',
			strokeWidth: 3,
		});
		expect(labelPaint({ kind: 'fill', fill: '#ffd166' }, parseCssColor, BACKGROUND)).toMatchObject({
			fill: '#111827',
			stroke: '#ffd166',
		});
	});

	it('keeps the theme ink with a background halo on the plot, wider across fill edges', () => {
		expect(labelPaint({ kind: 'plot' }, parseCssColor, BACKGROUND)).toEqual({
			fill: 'var(--foreground, #111827)',
			stroke: BACKGROUND,
			strokeWidth: 3,
		});
		expect(labelPaint({ kind: 'mixed' }, parseCssColor, BACKGROUND).strokeWidth).toBe(4);
	});

	it('falls back to the sticker halo while a fill colour cannot be resolved yet', () => {
		expect(labelPaint({ kind: 'fill', fill: 'var(--color-revenue)' }, () => null, BACKGROUND)).toEqual({
			fill: 'var(--foreground, #111827)',
			stroke: BACKGROUND,
			strokeWidth: 4,
		});
	});
});

describe('readableInkOn', () => {
	it('picks whichever ink contrasts more with the surface', () => {
		expect(readableInkOn(rgb('#104e64'))).toBe('#ffffff');
		expect(readableInkOn(rgb('#ffb900'))).toBe('#111827');
	});
});

describe('collectFillRegions', () => {
	it('builds normalised rectangles from bar points and ignores other series', () => {
		const items: GraphicalItem[] = [
			{
				item: { type: { displayName: 'Bar' }, props: { fill: '#4b2ff5' } },
				props: {
					data: [
						{ x: 10, y: 50, width: 20, height: 100 },
						{ x: 40, y: 150, width: 20, height: -30 },
					],
				},
			},
			{ item: { type: { displayName: 'Line' }, props: {} }, props: { points: [{ x: 0, y: 0 }] } },
		];
		expect(collectFillRegions(items)).toEqual([
			{ left: 10, right: 30, top: 50, bottom: 150, fill: '#4b2ff5' },
			{ left: 40, right: 60, top: 120, bottom: 150, fill: '#4b2ff5' },
		]);
	});
});

describe('combo chart labels over bars', () => {
	it('renders line labels that land on a dark bar in light ink without a DOM', () => {
		const chart = buildChart({
			data: [
				{ month: 'Jan', revenue: 1000, growth: 4 },
				{ month: 'Feb', revenue: 1000, growth: 5 },
				{ month: 'Mar', revenue: 1000, growth: 4 },
			],
			chartType: 'mixed',
			xAxisKey: 'month',
			xAxisType: 'category',
			series: [
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'growth', series_type: 'line', y_axis: 'right' },
			],
			colorFor: (key) => (key === 'revenue' ? '#4b2ff5' : '#4fb477'),
			backgroundColor: BACKGROUND,
			showDataLabels: true,
			yAxisRightMax: 10,
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 400 }));
		const labels = [...html.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)]
			.filter(([, attributes]) => attributes.includes('paint-order="stroke"'))
			.map(([, attributes, text]) => ({ text, fill: attributes.match(/\bfill="([^"]+)"/)?.[1] }));

		expect(labels).toContainEqual({ text: '5', fill: '#ffffff' });
		expect(labels).toContainEqual({ text: '1,000', fill: 'var(--foreground, #111827)' });
	});
});
