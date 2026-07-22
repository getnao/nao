import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildChart, computeKpiComparison, describePreviousPeriod } from '../src/chart-builder';

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

describe('computeKpiComparison', () => {
	const rows = [
		{ period: '2023-01-01', value: 100 },
		{ period: '2024-01-01', value: 120 },
	];

	it('returns null without a previous row', () => {
		expect(computeKpiComparison([rows[0]], 'period', 'value', 'percentage')).toBeNull();
	});

	it('returns null when comparison is disabled', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'none')).toBeNull();
		expect(computeKpiComparison(rows, 'period', 'value', undefined)).toBeNull();
	});

	it('computes a percentage increase', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'percentage')).toEqual({
			valueText: '20%',
			direction: 'up',
			colored: true,
			periodLabel: 'last year',
		});
	});

	it('infers the period label from a date column when xAxisKey is empty', () => {
		expect(
			computeKpiComparison(
				[
					{ month: '2024-01-01', revenue: 100 },
					{ month: '2024-02-01', revenue: 150 },
				],
				'',
				'revenue',
				'percentage',
			),
		).toMatchObject({ valueText: '50%', direction: 'up', periodLabel: 'last month' });
	});

	it('computes a percentage decrease as an unsigned magnitude', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 100 },
					{ period: '2024-01-01', value: 80 },
				],
				'period',
				'value',
				'percentage',
			),
		).toMatchObject({ valueText: '20%', direction: 'down', colored: true });
	});

	it('returns null for percentage change from zero', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 0 },
					{ period: '2024-01-01', value: 20 },
				],
				'period',
				'value',
				'percentage',
			),
		).toBeNull();
	});

	it('computes variation as a colored absolute delta', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'variation')).toMatchObject({
			valueText: '20',
			direction: 'up',
			colored: true,
		});
	});

	it('computes absolute mode without color', () => {
		expect(computeKpiComparison(rows, 'period', 'value', 'absolute')).toMatchObject({
			valueText: '20',
			direction: 'up',
			colored: false,
		});
	});

	it('marks an unchanged value as flat', () => {
		expect(
			computeKpiComparison(
				[
					{ period: '2023-01-01', value: 100 },
					{ period: '2024-01-01', value: 100 },
				],
				'period',
				'value',
				'percentage',
			),
		).toMatchObject({ valueText: '0%', direction: 'flat', colored: true });
	});
});

describe('describePreviousPeriod', () => {
	it('describes yearly date gaps', () => {
		expect(describePreviousPeriod('2023-01-01', '2024-01-01')).toBe('last year');
	});

	it('describes monthly date gaps', () => {
		expect(describePreviousPeriod('2024-01-01', '2024-02-01')).toBe('last month');
	});

	it('describes month-only date gaps', () => {
		expect(describePreviousPeriod('2024-01', '2024-02')).toBe('last month');
	});

	it('handles space-separated datetimes', () => {
		expect(describePreviousPeriod('2023-01-01 00:00:00', '2024-01-01 00:00:00')).toBe('last year');
	});

	it('describes weekly date gaps', () => {
		expect(describePreviousPeriod('2024-01-01', '2024-01-08')).toBe('last week');
	});

	it('falls back for non-date categories', () => {
		expect(describePreviousPeriod('Q1', 'Q2')).toBe('previous period');
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
