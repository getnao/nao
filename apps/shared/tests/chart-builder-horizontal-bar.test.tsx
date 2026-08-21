import React, { type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';

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
		expect(xAxis?.props).toMatchObject({ type: 'number', domain: [0, 110] });
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
): Array<{ text: string; textAnchor: string | undefined; x: number }> {
	const labels: Array<{ text: string; textAnchor: string | undefined; x: number }> = [];
	const textPattern = /<text([^>]*)>([^<]*)<\/text>/g;
	for (let match = textPattern.exec(html); match !== null; match = textPattern.exec(html)) {
		const attributes = match[1];
		if (!attributes.includes('recharts-horizontal-bar-value-label')) {
			continue;
		}
		const x = attributes.match(/\sx="([^"]+)"/)?.[1];
		const textAnchor = attributes.match(/\stext-anchor="([^"]+)"/)?.[1];
		labels.push({ text: match[2], textAnchor, x: Number(x) });
	}
	return labels;
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
	tickFormatter?: (value: number) => string;
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
