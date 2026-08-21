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
		expect(bars).toHaveLength(1);
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

function flattenChildren(children: unknown): ReactElement[] {
	if (Array.isArray(children)) {
		return children.flatMap(flattenChildren);
	}
	if (isReactElement(children)) {
		return [children];
	}
	return [];
}

function isReactElement(value: unknown): value is ReactElement {
	return typeof value === 'object' && value !== null && 'props' in value && 'type' in value;
}

function getDisplayName(element: ReactElement): string | undefined {
	return typeof element.type === 'string' ? element.type : (element.type as { displayName?: string }).displayName;
}
