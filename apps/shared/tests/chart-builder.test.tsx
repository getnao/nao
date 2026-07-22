import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';

describe('buildChart', () => {
	it('uses stack totals for stacked bar fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'stacked_bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 110]);
	});

	it('uses individual values for grouped bar fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 60]);
	});

	it('uses stack totals for stacked area fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'stacked_area',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 110]);
	});

	it('uses individual values for plain area fallback bounds', () => {
		const yAxis = getYAxis(
			buildChart({
				data: [{ name: 'A', costs: 60, revenue: 50 }],
				chartType: 'area',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'costs' }, { data_key: 'revenue' }],
				yAxisMin: 0,
			}),
		);

		expect(yAxis?.props.domain).toEqual([0, 60]);
	});

	it('uses the chart-specific prefix for area gradient ids and fills', () => {
		const firstChart = buildChart({
			data: [{ name: 'A', value: 10 }],
			chartType: 'area',
			xAxisKey: 'name',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			gradientIdPrefix: 'a-',
		});
		const secondChart = buildChart({
			data: [{ name: 'A', value: 10 }],
			chartType: 'area',
			xAxisKey: 'name',
			xAxisType: 'category',
			series: [{ data_key: 'value' }],
			gradientIdPrefix: 'b-',
		});

		expect(getGradient(firstChart)?.props.id).toBe('a-grad-0');
		expect(getArea(firstChart)?.props.fill).toBe('url(#a-grad-0)');
		expect(getGradient(secondChart)?.props.id).toBe('b-grad-0');
		expect(getGradient(firstChart)?.props.id).not.toBe(getGradient(secondChart)?.props.id);
	});

	it('shows and angles every compact category label with a custom tick font size', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				xAxisTickFontSize: 9,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.interval).toBe(0);
		expect(xAxis?.props.angle).toBe(-35);
		expect(xAxis?.props.textAnchor).toBe('end');
		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.tick).toEqual({ fontSize: 9 });
		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A very long category');
	});

	it('reserves the fixed category axis height when labels are not compact', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'Category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
			}),
		);

		expect(xAxis?.props.height).toBe(56);
		expect(xAxis?.props.angle).toBeUndefined();
	});

	it('does not truncate compact category labels without a character limit', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A very long category');
	});

	it('truncates compact category labels to the configured character limit', () => {
		const xAxis = getXAxis(
			buildChart({
				data: [{ name: 'A very long category', value: 10 }],
				chartType: 'bar',
				xAxisKey: 'name',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				compactXAxis: true,
				xAxisMaxLabelChars: 6,
				labelFormatter: (value) => value,
			}),
		);

		expect(xAxis?.props.tickFormatter('A very long category')).toBe('A ver…');
	});
});

function getYAxis(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'YAxis');
}

function getXAxis(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'XAxis');
}

function getGradient(chart: ReactElement): ReactElement | undefined {
	const definitions = flattenChildren(chart.props.children).find((child) => child.type === 'defs');
	return flattenChildren(definitions?.props.children).find((child) => child.type === 'linearGradient');
}

function getArea(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'Area');
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
