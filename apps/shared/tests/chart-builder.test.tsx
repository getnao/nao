import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildChart, computeValueAxisWidth, formatChartValue } from '../src/chart-builder';

describe('formatChartValue', () => {
	it('uses locale formatting by default', () => {
		expect(formatChartValue(1234)).toBe('1,234');
	});

	it('formats currency and places the prefix after the negative sign', () => {
		expect(
			formatChartValue(-1200, {
				d3_format: '.2s',
				prefix: '$',
			}),
		).toBe('-$1.2K');
	});

	it('adds a percentage suffix without multiplying the value', () => {
		expect(formatChartValue(42.5, { d3_format: '.1f', suffix: '%' })).toBe('42.5%');
	});

	it('maps SI billions to financial notation by default', () => {
		expect(formatChartValue(2_500_000_000, { d3_format: '.2s' })).toBe('2.5B');
	});

	it('keeps SI notation when requested', () => {
		expect(formatChartValue(2_500_000_000, { d3_format: '.2s', compact: 'si' })).toBe('2.5G');
	});

	it('falls back gracefully for an invalid d3 specifier', () => {
		expect(formatChartValue(1234, { d3_format: 'invalid', prefix: '$' }, { compact: true })).toBe('$1,234');
	});
});

describe('computeValueAxisWidth', () => {
	it('keeps short labels near the minimum width', () => {
		expect(computeValueAxisWidth([1, 10])).toBe(36);
		expect(computeValueAxisWidth([])).toBe(40);
	});

	it('expands for formatted currency labels and clamps extreme widths', () => {
		const valueFormat = { d3_format: ',.0f', prefix: '$' };
		const plainWidth = computeValueAxisWidth([1, 10]);
		const currencyWidth = computeValueAxisWidth([0, 980_000], valueFormat);

		expect(currencyWidth).toBeGreaterThan(plainWidth);
		expect(currencyWidth).toBe(82);
		expect(computeValueAxisWidth([0, Number.MAX_SAFE_INTEGER], valueFormat)).toBe(120);
	});
});

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
});

function getYAxis(chart: ReactElement): ReactElement | undefined {
	return flattenChildren(chart.props.children).find((child) => child.type.displayName === 'YAxis');
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
