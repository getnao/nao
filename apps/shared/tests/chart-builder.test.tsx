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
