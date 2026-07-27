import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart, niceAxisMax, shouldReserveDataLabelHeadroom } from '../src/chart-builder';

function renderChart(element: React.ReactElement) {
	return renderToString(React.cloneElement(element, { width: 600, height: 400 }));
}

function renderChartAtSize(element: React.ReactElement, width: number, height: number) {
	return renderToString(React.cloneElement(element, { width, height }));
}

interface RenderedLabel {
	x: number;
	y: number;
	text: string;
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** Parses the labels drawn by the shared data-label layer, mirroring its collision-box geometry. */
function parseDataLabels(html: string): RenderedLabel[] {
	const group = html.match(/<g class="recharts-data-labels">(.*?)<\/g>/s)?.[1] ?? '';
	const labels: RenderedLabel[] = [];
	const regex = /<text[^>]*\bx="([\d.]+)"[^>]*\by="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
	for (let match = regex.exec(group); match !== null; match = regex.exec(group)) {
		const x = Number(match[1]);
		const y = Number(match[2]);
		const text = match[3];
		const halfWidth = (text.length * 11 * 0.6) / 2;
		labels.push({
			x,
			y,
			text,
			left: x - halfWidth - 2,
			right: x + halfWidth + 2,
			top: y - 11 - 2,
			bottom: y + 2,
		});
	}
	return labels;
}

function hasOverlap(labels: RenderedLabel[]): boolean {
	for (let i = 0; i < labels.length; i += 1) {
		for (let j = i + 1; j < labels.length; j += 1) {
			const a = labels[i];
			const b = labels[j];
			if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
				return true;
			}
		}
	}
	return false;
}

function parsePlotRect(html: string): { left: number; top: number; right: number; bottom: number } {
	const rect = html.match(/<clipPath[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" height="([\d.]+)" width="([\d.]+)"/);
	const [, x, y, height, width] = (rect ?? ['0', '0', '0', '0', '0']).map(Number) as unknown as number[];
	return { left: x, top: y, right: x + width, bottom: y + height };
}

function parseXAxisTickY(html: string): number {
	const match = html.match(
		/<g class="recharts-layer recharts-cartesian-axis recharts-xAxis xAxis">.*?<text[^>]*\by="([\d.]+)"/s,
	);
	return Number(match?.[1] ?? 0);
}

function expectLabelsInsideSvg(labels: RenderedLabel[], width: number, height: number) {
	for (const label of labels) {
		expect(label.left).toBeGreaterThanOrEqual(0);
		expect(label.right).toBeLessThanOrEqual(width);
		expect(label.top).toBeGreaterThanOrEqual(0);
		expect(label.bottom).toBeLessThanOrEqual(height);
	}
}

describe('buildChart data labels', () => {
	it('rounds axis max using nice tick steps', () => {
		expect(niceAxisMax(622)).toBe(800);
		expect(niceAxisMax(780)).toBe(800);
		expect(niceAxisMax(460)).toBe(600);
	});

	it('does not reserve headroom when labels fit below the nice axis top', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 460 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(false);
	});

	it('reserves headroom when labels are close to the nice axis top', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(true);
	});

	it('does not reserve headroom when data labels are disabled', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
			}),
		).toBe(false);
	});

	it.each(['stacked_bar_100', 'stacked_area_100'] as const)(
		'reserves headroom and renders totals for %s',
		(chartType) => {
			const props = {
				data: [{ month: 'Jan', direct: 40, partner: 60 }],
				chartType,
				xAxisKey: 'month',
				xAxisType: 'category' as const,
				series: [{ data_key: 'direct' }, { data_key: 'partner' }],
				showDataLabels: true,
			};

			expect(shouldReserveDataLabelHeadroom(props)).toBe(true);
			expect(parseDataLabels(renderChart(buildChart(props))).some((label) => label.text === '100')).toBe(true);
		},
	);

	it('renders x and y axes for cartesian charts', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ month: 'Jan', sales: 460 },
					{ month: 'Feb', sales: 520 },
				],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
			}),
		);

		expect(html).toContain('recharts-yAxis');
		expect(html).toContain('recharts-xAxis');
	});

	it('renders point labels when enabled for bar charts', () => {
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', sales: 460 }],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
				showDataLabels: true,
			}),
		);

		expect(html).toContain('460');
	});

	it('renders stacked labels from non-total series only', () => {
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', new_sales: 100, renewal_sales: 200, total_sales: 300 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [
					{ data_key: 'new_sales' },
					{ data_key: 'renewal_sales' },
					{ data_key: 'total_sales', is_total: true },
				],
				showDataLabels: true,
			}),
		);

		expect(html.match(/>300<\/text>/g)).toHaveLength(1);
		expect(html).not.toContain('>600</text>');
	});

	it('does not render total series as stacked bar segments', () => {
		const colors: Record<string, string> = {
			new_sales: '#111111',
			renewal_sales: '#222222',
			total_sales: '#333333',
		};
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', new_sales: 100, renewal_sales: 200, total_sales: 300 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [
					{ data_key: 'new_sales' },
					{ data_key: 'renewal_sales' },
					{ data_key: 'total_sales', is_total: true },
				],
				colorFor: (key) => colors[key],
				showDataLabels: false,
			}),
		);

		expect(html).toContain('fill="#111111"');
		expect(html).toContain('fill="#222222"');
		expect(html).not.toContain('fill="#333333"');
	});

	it('drops only overlapping labels from dense line charts while keeping the max value', () => {
		const data = Array.from({ length: 40 }, (_, index) => ({
			day: `Day ${index + 1}`,
			value: index === 37 ? 999 : index + 1,
		}));
		const html = renderChart(
			buildChart({
				data,
				chartType: 'line',
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
			}),
		);
		const labels = parseDataLabels(html);

		expect(labels.length).toBeGreaterThan(0);
		expect(labels.length).toBeLessThan(data.length);
		expect(hasOverlap(labels)).toBe(false);
		expect(html).toContain('>999</text>');
	});

	it('renders on-slice value labels for pie charts when enabled', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ browser: 'Chrome', total: 275 },
					{ browser: 'Safari', total: 200 },
				],
				chartType: 'pie',
				xAxisKey: 'browser',
				series: [{ data_key: 'total' }],
				showDataLabels: true,
			}),
		);

		expect(html).toContain('>275</text>');
		expect(html).toContain('>200</text>');
	});

	it('does not render pie data labels when disabled', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ browser: 'Chrome', total: 275 },
					{ browser: 'Safari', total: 200 },
				],
				chartType: 'pie',
				xAxisKey: 'browser',
				series: [{ data_key: 'total' }],
			}),
		);

		expect(html).not.toContain('>275</text>');
		expect(html).not.toContain('>200</text>');
	});

	it.each(['pie', 'donut'] as const)('declutters dense %s labels within the SVG bounds', (chartType) => {
		const width = 240;
		const height = 180;
		const data = [
			{ category: 'Large', value: 6000 },
			...Array.from({ length: 9 }, (_, index) => ({ category: `Small ${index + 1}`, value: 500 })),
		];
		const html = renderChartAtSize(
			buildChart({
				data,
				chartType,
				xAxisKey: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
			}),
			width,
			height,
		);
		const labels = parseDataLabels(html);

		expect(labels.some((label) => label.text === '6,000')).toBe(true);
		expect(labels.length).toBeLessThan(data.length);
		expect(hasOverlap(labels)).toBe(false);
		expectLabelsInsideSvg(labels, width, height);
	});

	it('keeps non-extremum labels when their natural positions do not overlap', () => {
		const values = Array.from({ length: 36 }, () => 1);
		values[4] = 3;
		values[11] = 9;
		values[19] = 4;
		values[28] = 3;
		const data = values.map((value, index) => ({ day: `Day ${index + 1}`, value }));
		const html = renderChart(
			buildChart({
				data,
				chartType: 'line',
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
			}),
		);
		const labels = parseDataLabels(html);
		const baselineLabelCount = labels.filter((label) => label.text === '1').length;

		expect(html).toContain('>9</text>');
		expect(labels.length).toBeGreaterThan(12);
		expect(baselineLabelCount).toBeGreaterThan(0);
		expect(hasOverlap(labels)).toBe(false);
	});

	it('never overlaps labels across multiple bar series', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ month: 'Jan', revenue: 120, cost: 118 },
					{ month: 'Feb', revenue: 90, cost: 92 },
					{ month: 'Mar', revenue: 140, cost: 138 },
				],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'revenue' }, { data_key: 'cost' }],
				showDataLabels: true,
			}),
		);

		const labels = parseDataLabels(html);
		expect(labels.length).toBeGreaterThan(0);
		expect(hasOverlap(labels)).toBe(false);
		expect(labels.some((label) => label.text === '140')).toBe(true);
	});

	it('separates colliding bar and line labels in combo charts', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ year: '2019', revenue: 50, target: 52 },
					{ year: '2020', revenue: 70, target: 68 },
					{ year: '2021', revenue: 110, target: 64 },
				],
				chartType: 'mixed',
				xAxisKey: 'year',
				xAxisType: 'category',
				series: [
					{ data_key: 'revenue', series_type: 'bar' },
					{ data_key: 'target', series_type: 'line' },
				],
				showDataLabels: true,
			}),
		);

		const labels = parseDataLabels(html);
		expect(labels.length).toBeGreaterThan(0);
		expect(hasOverlap(labels)).toBe(false);
		expect(labels.some((label) => label.text === '110')).toBe(true);
	});

	it('keeps every data label inside the chart bounds (no clipping)', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ month: 'Jan', sales: 800 },
					{ month: 'Feb', sales: 300 },
				],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
				showDataLabels: true,
			}),
		);

		const plot = parsePlotRect(html);
		const labels = parseDataLabels(html);
		expect(labels.length).toBeGreaterThan(0);
		for (const label of labels) {
			// Horizontal placement never leaves the plot; vertical may use the reserved top headroom.
			expect(label.left).toBeGreaterThanOrEqual(plot.left - 0.5);
			expect(label.right).toBeLessThanOrEqual(plot.right + 0.5);
			expect(label.top).toBeGreaterThanOrEqual(-0.5);
			expect(label.bottom).toBeLessThanOrEqual(400.5);
		}
	});

	it('declutters stacked-area total labels instead of piling them up', () => {
		const data = Array.from({ length: 30 }, (_, index) => ({
			month: `M${index + 1}`,
			credit: 1500 + Math.round(Math.sin(index / 2) * 500),
			transfer: 1200 + Math.round(Math.cos(index / 2) * 400),
		}));
		const html = renderChart(
			buildChart({
				data,
				chartType: 'stacked_area',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'credit' }, { data_key: 'transfer' }],
				showDataLabels: true,
			}),
		);

		const labels = parseDataLabels(html);
		expect(labels.length).toBeGreaterThan(0);
		expect(labels.length).toBeLessThan(data.length);
		expect(hasOverlap(labels)).toBe(false);
	});

	it.each(['stacked_bar', 'stacked_area'] as const)(
		'anchors mixed-sign %s totals to the matching stack extreme',
		(chartType) => {
			const html = renderChart(
				buildChart({
					data: [
						{ category: 'Start', first: 10, last: 0 },
						{ category: 'Positive', first: 100, last: -30 },
						{ category: 'Negative', first: -100, last: 30 },
						{ category: 'End', first: 10, last: 0 },
					],
					chartType,
					xAxisKey: 'category',
					xAxisType: 'category',
					series: [{ data_key: 'first' }, { data_key: 'last' }],
					showDataLabels: true,
				}),
			);
			const plot = parsePlotRect(html);
			const labels = parseDataLabels(html);
			const positive = labels.find((label) => label.text === '70');
			const negative = labels.find((label) => label.text === '-70');

			expect(positive).toBeDefined();
			expect(negative).toBeDefined();
			expect(positive!.y).toBeLessThan(plot.top);
			expect(negative!.y).toBeGreaterThan(plot.bottom);
			expect(negative!.bottom).toBeLessThan(parseXAxisTickY(html));
		},
	);

	it('places line labels clear of the line, never straddling the data point', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ month: 'Jan', a: 100, b: 30 },
					{ month: 'Feb', a: 60, b: 90 },
					{ month: 'Mar', a: 120, b: 40 },
				],
				chartType: 'line',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'a' }, { data_key: 'b' }],
				showDataLabels: true,
			}),
		);

		const labels = parseDataLabels(html);
		expect(labels.length).toBeGreaterThan(0);
		expect(hasOverlap(labels)).toBe(false);
	});
});
