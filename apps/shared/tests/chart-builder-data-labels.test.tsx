import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';
import { shouldReserveDataLabelHeadroom } from '../src/chart-data-labels';
import { resolveBarYAxisDomain } from '../src/chart-domain';
import { CHART_NUMBER_LOCALE, niceAxisMax } from '../src/chart-values';

function renderChart(element: React.ReactElement) {
	return renderToString(React.cloneElement(element, { width: 600, height: 400 }));
}

function renderChartAtSize(element: React.ReactElement, width: number, height: number) {
	return renderToString(React.cloneElement(element, { width, height }));
}

function getYAxis(chart: React.ReactElement): React.ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'YAxis');
}

function flattenChildren(children: unknown): React.ReactElement[] {
	if (Array.isArray(children)) {
		return children.flatMap(flattenChildren);
	}
	if (React.isValidElement(children)) {
		return [children];
	}
	return [];
}

interface RenderedLabel {
	x: number;
	y: number;
	text: string;
	textAnchor: 'start' | 'middle' | 'end';
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function parseDataLabels(html: string): RenderedLabel[] {
	const group = html.match(/<g class="recharts-data-labels">(.*?)<\/g>/s)?.[1] ?? '';
	const labels: RenderedLabel[] = [];
	const regex = /<text([^>]*)>([^<]*)<\/text>/g;
	for (let match = regex.exec(group); match !== null; match = regex.exec(group)) {
		const attributes = match[1];
		const x = Number(readAttribute(attributes, 'x'));
		const y = Number(readAttribute(attributes, 'y'));
		const text = match[2];
		const textAnchor = (readAttribute(attributes, 'text-anchor') ?? 'middle') as RenderedLabel['textAnchor'];
		const halfWidth = (text.length * 11 * 0.6) / 2;
		const left = textAnchor === 'start' ? x : textAnchor === 'end' ? x - halfWidth * 2 : x - halfWidth;
		const right = textAnchor === 'start' ? x + halfWidth * 2 : textAnchor === 'end' ? x : x + halfWidth;
		labels.push({
			x,
			y,
			text,
			textAnchor,
			left: left - (textAnchor === 'start' ? 0 : 2),
			right: right + (textAnchor === 'end' ? 0 : 2),
			top: y - 11 - 2,
			bottom: y + 2,
		});
	}
	return labels;
}

interface RenderedPieSector {
	cx: number;
	cy: number;
	outerRadius: number;
	text: string;
}

function parsePieSectors(html: string, texts: string[]): RenderedPieSector[] {
	const sectors: RenderedPieSector[] = [];
	const regex = /<path([^>]*\bclass="recharts-sector"[^>]*)>/g;
	for (let match = regex.exec(html); match !== null; match = regex.exec(html)) {
		const attributes = match[1];
		const path = readAttribute(attributes, 'd') ?? '';
		const center = path.match(/L\s*([-\d.]+),([-\d.]+)\s*Z/);
		const arc = path.match(/A\s*([-\d.]+),([-\d.]+)/);
		sectors.push({
			cx: Number(readAttribute(attributes, 'cx') ?? center?.[1]),
			cy: Number(readAttribute(attributes, 'cy') ?? center?.[2]),
			outerRadius: Number(arc?.[1]),
			text: texts[sectors.length],
		});
	}
	return sectors;
}

function readAttribute(attributes: string, name: string): string | undefined {
	return attributes.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
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

function expectLabelsInsidePlot(labels: RenderedLabel[], plot: ReturnType<typeof parsePlotRect>) {
	for (const label of labels) {
		expect(label.left).toBeGreaterThanOrEqual(plot.left - 0.5);
		expect(label.right).toBeLessThanOrEqual(plot.right + 0.5);
		expect(label.top).toBeGreaterThanOrEqual(plot.top - 0.5);
		expect(label.bottom).toBeLessThanOrEqual(plot.bottom + 0.5);
	}
}

const EDGE_LABEL_DATA = [79, 604, 769, 1057, 1220, 1349, 1449].map((value, index) => ({
	month: `2026-${String(index + 1).padStart(2, '0')}`,
	value,
}));

function renderEdgeLabelChart(chartType: 'area' | 'line', width = 980, height = 260) {
	return renderChartAtSize(
		buildChart({
			data: EDGE_LABEL_DATA,
			chartType,
			xAxisKey: 'month',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			showDataLabels: true,
			margin: { top: 0, right: 0, bottom: 0, left: 0 },
		}),
		width,
		height,
	);
}

describe('buildChart data labels', () => {
	it('keeps the full last area label inside the chart', () => {
		const width = 980;
		const height = 260;
		const labels = parseDataLabels(renderEdgeLabelChart('area', width, height));
		const lastLabel = labels.find((label) => label.text === '1,449');

		expect(lastLabel).toBeDefined();
		expect(lastLabel!.textAnchor).toBe('end');
		expectLabelsInsideSvg(labels, width, height);
		expect(hasOverlap(labels)).toBe(false);
	});

	it('keeps the full last line label inside the chart', () => {
		const width = 980;
		const height = 260;
		const labels = parseDataLabels(renderEdgeLabelChart('line', width, height));
		const lastLabel = labels.find((label) => label.text === '1,449');

		expect(lastLabel).toBeDefined();
		expect(lastLabel!.textAnchor).toBe('end');
		expectLabelsInsideSvg(labels, width, height);
	});

	it('keeps the first point label inside the left edge', () => {
		const width = 980;
		const height = 260;
		const labels = parseDataLabels(renderEdgeLabelChart('area', width, height));
		const firstLabel = labels.find((label) => label.text === '79');

		expect(firstLabel).toBeDefined();
		expect(firstLabel!.textAnchor).toBe('start');
		expectLabelsInsideSvg([firstLabel!], width, height);
	});

	it('rounds axis max using nice tick steps', () => {
		expect(niceAxisMax(622)).toBe(800);
		expect(niceAxisMax(780)).toBe(800);
		expect(niceAxisMax(460)).toBe(600);
	});

	it('does not reserve area headroom when labels fit below the nice axis top', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 460 }],
				chartType: 'area',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(false);
	});

	it('does not reserve margin headroom for bar charts', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(false);
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

	it.each(['line', 'area', 'mixed'] as const)('keeps margin headroom behavior for %s charts', (chartType) => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType,
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(true);
	});

	it('renders the tallest bar label inside a short plot', () => {
		const width = 600;
		const height = 200;
		expect(resolveBarYAxisDomain(undefined, undefined, [250, 500], true)).toEqual([0, 600]);
		const html = renderChartAtSize(
			buildChart({
				data: [
					{ month: 'Jan', sales: 250 },
					{ month: 'Feb', sales: 500 },
				],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
				showDataLabels: true,
			}),
			width,
			height,
		);
		const labels = parseDataLabels(html);
		const plot = parsePlotRect(html);

		expect(labels.some((label) => label.text === '500')).toBe(true);
		expect(labels.every((label) => label.textAnchor === 'middle')).toBe(true);
		expectLabelsInsideSvg(labels, width, height);
		expectLabelsInsidePlot(labels, plot);
	});

	it('keeps an explicit y-axis maximum instead of padding it', () => {
		expect(resolveBarYAxisDomain(undefined, 500, [250, 500], true)).toEqual([0, 500]);
	});

	it('does not let a total series inflate the stacked bar domain', () => {
		const props = {
			data: [{ month: 'Jan', direct: 100, partner: 200, total: 300 }],
			chartType: 'stacked_bar' as const,
			xAxisKey: 'month',
			xAxisType: 'category' as const,
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
			showDataLabels: true,
		};
		const domainWithoutTotal = getYAxis(buildChart(props))?.props.domain;
		const domainWithTotal = getYAxis(
			buildChart({
				...props,
				series: [...props.series, { data_key: 'total', is_total: true }],
			}),
		)?.props.domain;

		expect(domainWithoutTotal).toEqual([0, 400]);
		expect(domainWithTotal?.[1]).toBe(domainWithoutTotal?.[1]);
	});

	it('ignores hidden total values when deciding stacked bar headroom', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ month: 'Jan', direct: 100, partner: 200, total: -999 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				series: [{ data_key: 'direct' }, { data_key: 'partner' }, { data_key: 'total', is_total: true }],
				showDataLabels: true,
			}),
		).toBe(false);
	});

	it('does not let a total series inflate the stacked area domain', () => {
		const props = {
			data: [{ month: 'Jan', direct: 100, partner: 200, total: 300 }],
			chartType: 'stacked_area' as const,
			xAxisKey: 'month',
			xAxisType: 'category' as const,
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
			yAxisMin: 0,
			showDataLabels: true,
		};
		const domainWithoutTotal = getYAxis(buildChart(props))?.props.domain;
		const domainWithTotal = getYAxis(
			buildChart({
				...props,
				series: [...props.series, { data_key: 'total', is_total: true }],
			}),
		)?.props.domain;

		expect(domainWithoutTotal).toEqual([0, 300]);
		expect(domainWithTotal?.[1]).toBe(domainWithoutTotal?.[1]);
	});

	it('falls back to margin headroom when an explicit maximum disables padding', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ month: 'Jan', sales: 780 }],
				chartType: 'bar',
				xAxisKey: 'month',
				series: [{ data_key: 'sales' }],
				showDataLabels: true,
				yAxisMax: 780,
			}),
		).toBe(true);
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ month: 'Jan', direct: 200, partner: 300 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				series: [{ data_key: 'direct' }, { data_key: 'partner' }],
				showDataLabels: true,
				yAxisMax: 500,
			}),
		).toBe(true);
	});

	it('keeps bar plot geometry independent of data labels', () => {
		const props = {
			data: [
				{ month: 'Jan', sales: 250 },
				{ month: 'Feb', sales: 500 },
			],
			chartType: 'bar' as const,
			xAxisKey: 'month',
			xAxisType: 'category' as const,
			series: [{ data_key: 'sales' }],
		};
		const labelsOn = renderChartAtSize(buildChart({ ...props, showDataLabels: true }), 600, 200);
		const labelsOff = renderChartAtSize(buildChart({ ...props, showDataLabels: false }), 600, 200);

		expect(parsePlotRect(labelsOn)).toEqual(parsePlotRect(labelsOff));
	});

	it('does not pad a bar domain containing negative values', () => {
		expect(resolveBarYAxisDomain(undefined, undefined, [-50, 500], true)).toBeUndefined();
	});

	it('keeps the top label for a bar chart containing negative values', () => {
		const width = 600;
		const height = 200;
		const props = {
			data: [
				{ month: 'Jan', sales: -50 },
				{ month: 'Feb', sales: 780 },
			],
			chartType: 'bar' as const,
			xAxisKey: 'month',
			xAxisType: 'category' as const,
			series: [{ data_key: 'sales' }],
			showDataLabels: true,
		};
		const html = renderChartAtSize(buildChart(props), width, height);
		const topLabel = parseDataLabels(html).find((label) => label.text === '780');

		expect(shouldReserveDataLabelHeadroom(props)).toBe(true);
		expect(topLabel).toBeDefined();
		expectLabelsInsideSvg([topLabel!], width, height);
	});

	it('renders a stacked bar total without changing plot geometry', () => {
		const props = {
			data: [
				{ month: 'Jan', direct: 100, partner: 150 },
				{ month: 'Feb', direct: 200, partner: 300 },
			],
			chartType: 'stacked_bar' as const,
			xAxisKey: 'month',
			xAxisType: 'category' as const,
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
		};
		const labelsOn = renderChartAtSize(buildChart({ ...props, showDataLabels: true }), 600, 200);
		const labelsOff = renderChartAtSize(buildChart({ ...props, showDataLabels: false }), 600, 200);

		expect(parseDataLabels(labelsOn).some((label) => label.text === '500')).toBe(true);
		expect(parsePlotRect(labelsOn)).toEqual(parsePlotRect(labelsOff));
		expect(shouldReserveDataLabelHeadroom({ ...props, showDataLabels: true })).toBe(false);
	});

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

	it.each(['pie', 'donut'] as const)('renders value labels outside %s slices when enabled', (chartType) => {
		const html = renderChart(
			buildChart({
				data: [
					{ browser: 'Chrome', total: 275 },
					{ browser: 'Safari', total: 200 },
				],
				chartType,
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
			...Array.from({ length: 9 }, (_, index) => ({ category: `Small ${index + 1}`, value: 500 - index })),
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
		const sectors = parsePieSectors(
			html,
			data.map((entry) => entry.value.toLocaleString(CHART_NUMBER_LOCALE)),
		);

		expect(labels.some((label) => label.text === '6,000')).toBe(true);
		expect(labels.length).toBeLessThan(data.length);
		expect(hasOverlap(labels)).toBe(false);
		expectLabelsInsideSvg(labels, width, height);
		for (const label of labels) {
			const sector = sectors.find((entry) => entry.text === label.text);
			expect(sector).toBeDefined();
			const anchorRadius = Math.hypot(label.x - sector!.cx, label.y - sector!.cy);
			expect(anchorRadius).toBeGreaterThan(sector!.outerRadius);
			expect(label.textAnchor).toBe(label.x >= sector!.cx ? 'start' : 'end');
		}
	});

	it.each(['line', 'area'] as const)(
		'limits dense %s labels while preserving extrema and full-domain coverage',
		(chartType) => {
			const data = [
				{ day: 'Padding start', value: null },
				...Array.from({ length: 30 }, (_, index) => ({ day: `Day ${index + 1}`, value: index + 1 })),
				{ day: 'Padding end', value: null },
			];
			const html = renderChartAtSize(
				buildChart({
					data,
					chartType,
					xAxisKey: 'day',
					xAxisType: 'category',
					series: [{ data_key: 'value' }],
					showDataLabels: true,
				}),
				1200,
				400,
			);
			const labels = parseDataLabels(html);
			const values = labels.map((label) => Number(label.text));

			expect(labels).toHaveLength(12);
			expect(values).toContain(1);
			expect(values).toContain(30);
			expect(values.some((value) => value >= 12 && value <= 19)).toBe(true);
			expect(values.filter((value) => value >= 20).length).toBeLessThanOrEqual(5);
			expect(hasOverlap(labels)).toBe(false);
		},
	);

	it.each(['line', 'area'] as const)('keeps every sparse %s candidate before collision resolution', (chartType) => {
		const values = [10, 40, 20, 50, 30];
		const data = [
			{ day: 'Padding start', value: null },
			...values.map((value, index) => ({ day: `Day ${index + 1}`, value })),
			{ day: 'Padding end', value: null },
		];
		const html = renderChartAtSize(
			buildChart({
				data,
				chartType,
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
				yAxisMax: 60,
			}),
			900,
			400,
		);
		const labels = parseDataLabels(html);

		expect(labels.map((label) => Number(label.text)).sort((a, b) => a - b)).toEqual(
			[...values].sort((a, b) => a - b),
		);
		expect(hasOverlap(labels)).toBe(false);
	});

	it.each(['line', 'area'] as const)('resolves dense multi-series %s labels globally', (chartType) => {
		const data = [
			{ day: 'Padding start', first: null, second: null },
			...Array.from({ length: 30 }, (_, index) => ({
				day: `Day ${index + 1}`,
				first: 100 + index * 5,
				second: 400 - index * 7,
			})),
			{ day: 'Padding end', first: null, second: null },
		];
		const html = renderChartAtSize(
			buildChart({
				data,
				chartType,
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'first' }, { data_key: 'second' }],
				showDataLabels: true,
			}),
			1200,
			500,
		);
		const labels = parseDataLabels(html);

		expect(labels.length).toBeGreaterThan(0);
		expect(labels.length).toBeLessThanOrEqual(24);
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
			expectLabelsInsideSvg([positive!], 600, 400);
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
