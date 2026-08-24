import React, { type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';
import { boxesOverlap, labelBox } from '../src/chart-data-labels';

describe('buildChart horizontal bars', () => {
	it('builds one horizontal bar series with category and hidden value axes', () => {
		const chart = buildChart({
			data: [
				{ category: 'First', value: 20 },
				{ category: 'Second', value: 50 },
			],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const children = flattenChildren(chart.props.children);
		const bars = children.filter((child) => getDisplayName(child) === 'Bar');
		const xAxis = children.find((child) => getDisplayName(child) === 'XAxis');
		const yAxis = children.find((child) => getDisplayName(child) === 'YAxis');

		expect(chart.type.displayName).toBe('BarChart');
		expect(chart.props.layout).toBe('vertical');
		expect(chart.props.stackOffset).toBeUndefined();
		expect(chart.props.barCategoryGap).toBeUndefined();
		expect(bars).toHaveLength(1);
		expect(bars[0].props).toMatchObject({
			radius: [999, 999, 999, 999],
			barSize: 10,
		});
		expect('stackId' in bars[0].props).toBe(false);
		expect('shape' in bars[0].props).toBe(false);
		expect('maxBarSize' in bars[0].props).toBe(false);
		expect(bars[0].props.background).toBeTypeOf('function');
		expect(xAxis?.props).toMatchObject({ type: 'number', hide: true, domain: [0, 50] });
		expect(yAxis?.props).toMatchObject({ type: 'category', dataKey: 'category' });
	});

	it('adds vertical label room to caller-supplied margins', () => {
		const props = {
			data: [{ category: 'First', value: 50 }],
			chartType: 'horizontal_bar' as const,
			xAxisKey: 'category',
			xAxisType: 'category' as const,
			series: [{ data_key: 'value' }],
		};
		const chart = buildChart(props);
		const chartWithMargin = buildChart({ ...props, margin: { top: 5, right: 5, bottom: 5 } });
		const hiddenLabelsChart = buildChart({ ...props, showDataLabels: false });

		expect(chart.props.margin.top).toBeGreaterThanOrEqual(8);
		expect(chart.props.margin.bottom).toBeGreaterThanOrEqual(8);
		expect(chartWithMargin.props.margin.top).toBe(chart.props.margin.top + 5);
		expect(chartWithMargin.props.margin.right).toBe(chart.props.margin.right + 5);
		expect(chartWithMargin.props.margin.bottom).toBe(chart.props.margin.bottom + 5);
		expect(hiddenLabelsChart.props.margin.top).toBe(chart.props.margin.top);
		expect(hiddenLabelsChart.props.margin.bottom).toBe(chart.props.margin.bottom);
	});

	it('keeps category labels beyond the rotated-axis limit and sizes the axis to fit', () => {
		const chart = buildChart({
			data: [{ category: 'Eleanor Roberts', value: 20 }],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			labelFormatter: (value) => value,
			xAxisMaxLabelChars: 14,
		});
		const yAxis = flattenChildren(chart.props.children).find((child) => getDisplayName(child) === 'YAxis');

		expect(yAxis?.props.tickFormatter?.('Eleanor Roberts')).toBe('Eleanor Roberts');
		expect(yAxis?.props.width).toBe(117);
		expect(yAxis?.props.width).toBeLessThanOrEqual(180);
	});

	it('truncates category labels longer than 24 characters', () => {
		const chart = buildChart({
			data: [{ category: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', value: 20 }],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			labelFormatter: (value) => value,
		});
		const yAxis = flattenChildren(chart.props.children).find((child) => getDisplayName(child) === 'YAxis');
		const formattedLabel = yAxis?.props.tickFormatter?.('ABCDEFGHIJKLMNOPQRSTUVWXYZ');

		expect(formattedLabel).toBe('ABCDEFGHIJKLMNOPQRSTUVW…');
		expect(formattedLabel).toHaveLength(24);
	});

	it('applies the series value format to the always-visible labels', () => {
		const chart = buildChart({
			data: [{ category: 'First', value: 1200 }],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value', value_format: { d3_format: ',.0f', prefix: '$', suffix: ' USD' } }],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));

		expect(readHorizontalBarValueLabels(html).map((label) => label.text)).toEqual(['$1,200 USD']);
		expect(html).toContain('fill="var(--muted, #e5e7eb)"');
	});

	it('renders formatted values in a fixed right-aligned column', () => {
		const chart = buildChart({
			data: [
				{ category: 'Short', value: 200 },
				{ category: 'Long', value: 1200 },
			],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value', value_format: { d3_format: ',.0f', prefix: '$', suffix: ' USD' } }],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const labels = readHorizontalBarValueLabels(html);

		expect(labels.map((label) => label.text)).toEqual(['$200 USD', '$1,200 USD']);
		expect(labels[0].x).toBe(labels[1].x);
		expect(labels.every((label) => label.textAnchor === 'end')).toBe(true);
	});

	it('stacks multiple series over one track and labels row totals', () => {
		const chart = buildChart({
			data: [
				{ category: 'First', direct: 20, partner: 30, total: 50 },
				{ category: 'Second', direct: 40, partner: 70, total: 110 },
			],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'direct' }, { data_key: 'partner' }, { data_key: 'total', is_total: true }],
		});
		const children = flattenChildren(chart.props.children);
		const bars = children.filter((child) => getDisplayName(child) === 'Bar');
		const xAxis = children.find((child) => getDisplayName(child) === 'XAxis');
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));

		expect(bars).toHaveLength(2);
		expect(bars.map((bar) => bar.props.stackId)).toEqual(['stack', 'stack']);
		expect(bars.every((bar) => !('barSize' in bar.props))).toBe(true);
		expect(bars.map((bar) => bar.props.maxBarSize)).toEqual([28, 28]);
		expect(chart.props.barCategoryGap).toBe('20%');
		expect(bars.filter((bar) => Boolean(bar.props.background))).toHaveLength(1);
		expect(xAxis?.props).toMatchObject({ type: 'number' });
		expect(xAxis?.props.domain).toBeUndefined();
		expect(xAxis?.props.hide).not.toBe(true);
		expect(readHorizontalBarValueLabels(html).map((label) => label.text)).toEqual(['50', '110']);

		const leftSegment = bars[0].props.shape?.({ payload: { direct: 20, partner: 30 } });
		const rightSegment = bars[1].props.shape?.({ payload: { direct: 20, partner: 30 } });
		const onlyVisibleSegment = bars[1].props.shape?.({ payload: { direct: 0, partner: 30 } });
		expect(leftSegment).toBeDefined();
		expect(rightSegment).toBeDefined();
		expect(onlyVisibleSegment).toBeDefined();
		expect(leftSegment!.props).toMatchObject({
			radius: [999, 0, 0, 999],
			stroke: 'var(--background, #ffffff)',
			strokeWidth: 1,
		});
		expect(rightSegment!.props).toMatchObject({
			radius: [0, 999, 999, 0],
			stroke: 'var(--background, #ffffff)',
			strokeWidth: 1,
		});
		expect(onlyVisibleSegment!.props.radius).toEqual([999, 999, 999, 999]);
	});

	it('renders distinct value-axis ticks for all-zero multi-series data', () => {
		const chart = buildChart({
			data: [
				{ category: 'First', direct: 0, partner: 0 },
				{ category: 'Second', direct: 0, partner: 0 },
			],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [
				{ data_key: 'direct', value_format: { d3_format: ',.0f' } },
				{ data_key: 'partner', value_format: { d3_format: ',.0f' } },
			],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const axisTickTexts = readHorizontalBarValueAxisTicks(html);

		expect(axisTickTexts.length).toBeGreaterThan(0);
		expect(axisTickTexts).not.toEqual(['0', '0', '1', '1', '1']);
		expect(axisTickTexts).toEqual([...new Set(axisTickTexts)]);
	});

	it('clamps mixed-sign series for the domain while preserving the signed total label', () => {
		const chart = buildChart({
			data: [{ category: 'First', direct: 100, partner: -100 }],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
		});
		const xAxis = flattenChildren(chart.props.children).find((child) => getDisplayName(child) === 'XAxis');
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));

		expect(xAxis?.props.domain).toBeUndefined();
		expect(chart.props.data[0]).toMatchObject({ direct: 100, partner: 0 });
		expect(readHorizontalBarValueLabels(html).map((label) => label.text)).toEqual(['0']);
	});

	it('renders a negative single-series value at the origin with its signed label', () => {
		const chart = buildChart({
			data: [{ category: 'First', value: -30 }],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const xAxis = flattenChildren(chart.props.children).find((child) => getDisplayName(child) === 'XAxis');
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));

		expect(xAxis?.props.domain).toEqual([0, 1]);
		expect(chart.props.data[0].value).toBe(0);
		expect(readHorizontalBarValueLabels(html).map((label) => label.text)).toEqual(['-30']);
	});

	it('normalizes stacked horizontal bars to a percentage axis', () => {
		const props = {
			data: [{ category: 'First', direct: 20, partner: 30 }],
			chartType: 'horizontal_bar_100' as const,
			xAxisKey: 'category',
			xAxisType: 'category' as const,
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
		};
		const chart = buildChart(props);
		const labelledChart = buildChart({ ...props, showDataLabels: true });
		const children = flattenChildren(chart.props.children);
		const bars = children.filter((child) => getDisplayName(child) === 'Bar');
		const xAxis = children.find((child) => getDisplayName(child) === 'XAxis');
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const labelledHtml = renderToString(React.cloneElement(labelledChart, { width: 600, height: 300 }));

		expect(chart.props.stackOffset).toBe('expand');
		expect(bars).toHaveLength(2);
		expect(xAxis?.props.domain).toEqual([0, 1]);
		expect(xAxis?.props.tickFormatter?.(0.5)).toBe('50%');
		expect(readHorizontalBarValueLabels(html)).toHaveLength(0);
		expect(readHorizontalBarValueLabels(labelledHtml).map((label) => label.text)).toEqual(['100%']);
	});

	it('labels empty normalized rows as zero percent', () => {
		const chart = buildChart({
			data: [
				{ category: 'Empty', direct: 0, partner: 0 },
				{ category: 'Full', direct: 20, partner: 30 },
			],
			chartType: 'horizontal_bar_100',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'direct' }, { data_key: 'partner' }],
			showDataLabels: true,
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));

		expect(readHorizontalBarValueLabels(html).map((label) => label.text)).toEqual(['0%', '100%']);
	});

	it('renders zero and null values at the bar origin', () => {
		const chart = buildChart({
			data: [
				{ category: 'Zero', value: 0 },
				{ category: 'Missing', value: null },
				{ category: 'Full', value: 100 },
			],
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const labels = readHorizontalBarValueLabels(html);

		expect(labels.slice(0, 2).map((label) => label.text)).toEqual(['0', '0']);
		expect(labels[0].x).toBe(labels[1].x);
	});

	it('skips value labels and category ticks that do not fit', () => {
		const rowCount = 96;
		const chart = buildChart({
			data: Array.from({ length: rowCount }, (_, index) => ({
				category: `Month ${index + 1}`,
				value: index + 1,
			})),
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const yAxis = flattenChildren(chart.props.children).find((child) => getDisplayName(child) === 'YAxis');
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const labels = readHorizontalBarValueLabels(html);
		const boxes = labels.map((label) => labelBox(label.x, label.y, (label.text.length * 7) / 2, 'end', 12));

		expect(labels.length).toBeGreaterThan(0);
		expect(labels.length).toBeLessThan(rowCount);
		expect(labels[0].text).toBe('1');
		expect(boxes.every((box, index) => boxes.slice(index + 1).every((other) => !boxesOverlap(box, other)))).toBe(
			true,
		);
		expect(yAxis?.props.interval).toBe('preserveStartEnd');
	});

	it('keeps value labels inside a dense horizontal bar chart', () => {
		const chartHeight = 300;
		const fontSize = 12;
		const chart = buildChart({
			data: Array.from({ length: 60 }, (_, index) => ({
				category: `Customer ${index + 1}`,
				value: index + 1,
			})),
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: chartHeight }));
		const labels = readHorizontalBarValueLabels(html);
		const labelTops = labels.map((label) => label.y - fontSize / 2);
		const labelBottoms = labels.map((label) => label.y + fontSize / 2);

		expect(labels.length).toBeGreaterThan(0);
		expect(Math.min(...labelTops)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...labelBottoms)).toBeLessThanOrEqual(chartHeight);
	});

	it('keeps the first value label centered on its bar', () => {
		const chart = buildChart({
			data: Array.from({ length: 60 }, (_, index) => ({
				category: `Customer ${index + 1}`,
				value: index + 1,
			})),
			chartType: 'horizontal_bar',
			xAxisKey: 'category',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
		});
		const html = renderToString(React.cloneElement(chart, { width: 600, height: 300 }));
		const labels = readHorizontalBarValueLabels(html);
		const barCenters = readHorizontalBarCenters(html);

		expect(labels.length).toBeGreaterThan(0);
		expect(barCenters.length).toBeGreaterThan(0);
		expect(labels[0].y).toBe(barCenters[0]);
	});

	it('shows value labels by default and removes their margin when hidden', () => {
		const props = {
			data: [{ category: 'First', value: 50 }],
			chartType: 'horizontal_bar' as const,
			xAxisKey: 'category',
			xAxisType: 'category' as const,
			series: [{ data_key: 'value' }],
		};
		const visibleChart = buildChart(props);
		const hiddenChart = buildChart({ ...props, showDataLabels: false });
		const visibleHtml = renderToString(React.cloneElement(visibleChart, { width: 600, height: 300 }));
		const hiddenHtml = renderToString(React.cloneElement(hiddenChart, { width: 600, height: 300 }));

		expect(readHorizontalBarValueLabels(visibleHtml)).toHaveLength(1);
		expect(readHorizontalBarValueLabels(hiddenHtml)).toHaveLength(0);
		expect(visibleChart.props.margin.right).toBeGreaterThan(hiddenChart.props.margin?.right ?? 0);
	});
});

function readHorizontalBarValueLabels(
	html: string,
): Array<{ text: string; textAnchor: string | undefined; x: number; y: number }> {
	const labels: Array<{ text: string; textAnchor: string | undefined; x: number; y: number }> = [];
	const textPattern = /<text([^>]*)>([^<]*)<\/text>/g;
	for (let match = textPattern.exec(html); match !== null; match = textPattern.exec(html)) {
		const attributes = match[1];
		if (!attributes.includes('recharts-horizontal-bar-value-label')) {
			continue;
		}
		const x = attributes.match(/\sx="([^"]+)"/)?.[1];
		const y = attributes.match(/\sy="([^"]+)"/)?.[1];
		const textAnchor = attributes.match(/\stext-anchor="([^"]+)"/)?.[1];
		labels.push({ text: match[2], textAnchor, x: Number(x), y: Number(y) });
	}
	return labels;
}

function readHorizontalBarValueAxisTicks(html: string): string[] {
	const axisStart = html.indexOf('recharts-xAxis');
	const nextAxisStart = html.indexOf('recharts-yAxis', axisStart);
	const axisGroup = axisStart >= 0 ? html.slice(axisStart, nextAxisStart >= 0 ? nextAxisStart : undefined) : '';
	const tickTexts: string[] = [];
	const textPattern = /<text([^>]*)>([\s\S]*?)<\/text>/g;
	for (let match = textPattern.exec(axisGroup); match !== null; match = textPattern.exec(axisGroup)) {
		if (match[1].includes('recharts-cartesian-axis-tick-value')) {
			tickTexts.push(match[2].replace(/<[^>]+>/g, ''));
		}
	}
	return tickTexts;
}

function readHorizontalBarCenters(html: string): number[] {
	const centers: number[] = [];
	const barPattern = /<g([^>]*)><path([^>]*)>/g;
	for (let match = barPattern.exec(html); match !== null; match = barPattern.exec(html)) {
		const className = match[1].match(/\sclass="([^"]+)"/)?.[1];
		if (!className?.split(' ').includes('recharts-bar-rectangle')) {
			continue;
		}
		const y = match[2].match(/\sy="([^"]+)"/)?.[1];
		const height = match[2].match(/\sheight="([^"]+)"/)?.[1];
		if (y !== undefined && height !== undefined) {
			centers.push(Number(y) + Number(height) / 2);
		}
	}
	return centers;
}

interface TestElementProps {
	[key: string]: unknown;
	background?: unknown;
	barSize?: number;
	domain?: unknown;
	hide?: boolean;
	maxBarSize?: number;
	radius?: number[];
	shape?: (props: unknown) => ReactElement<{ radius?: number[]; stroke?: string; strokeWidth?: number }>;
	stackId?: string;
	tickFormatter?: (value: string | number) => string;
	width?: number;
}

type TestElement = ReactElement<TestElementProps>;

function flattenChildren(children: unknown): TestElement[] {
	if (Array.isArray(children)) {
		return children.flatMap(flattenChildren);
	}
	if (isReactElement(children)) {
		return [children];
	}
	return [];
}

function isReactElement(value: unknown): value is TestElement {
	return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function getDisplayName(element: TestElement): string | undefined {
	return typeof element.type === 'string' ? element.type : (element.type as { displayName?: string }).displayName;
}
