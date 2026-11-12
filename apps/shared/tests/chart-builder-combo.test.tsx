import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';
import type { SeriesConfig } from '../src/tools/display-chart';
import { findChartElements } from './helpers/chart-elements';

const data = [
	{ month: '2024-01', revenue: 1000, orders: 12 },
	{ month: '2024-02', revenue: 1500, orders: 18 },
];

const LEFT_BAR_RIGHT_LINE: SeriesConfig[] = [
	{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
	{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
];

function combo(series: SeriesConfig[], overrides: Record<string, unknown> = {}) {
	return buildChart({
		data,
		chartType: 'mixed',
		xAxisKey: 'month',
		xAxisType: 'category',
		series,
		renderTitle: false,
		...overrides,
	});
}

describe('buildChart (combo)', () => {
	it('draws a second Y-axis when a series uses the right axis', () => {
		const axes = findChartElements(combo(LEFT_BAR_RIGHT_LINE), 'YAxis');
		expect(axes.map((a) => a.props.yAxisId).sort()).toEqual(['left', 'right']);
	});

	it('renders both bar and line series in one chart', () => {
		const chart = combo([
			{ data_key: 'revenue', series_type: 'bar' },
			{ data_key: 'orders', series_type: 'line' },
		]);
		expect(findChartElements(chart, 'Bar')).toHaveLength(1);
		expect(findChartElements(chart, 'Line')).toHaveLength(1);
	});

	it.each(['left', 'right'] as const)('draws a single %s Y-axis when every series is on that side', (side) => {
		const axes = findChartElements(
			combo([
				{ data_key: 'revenue', series_type: 'bar', y_axis: side },
				{ data_key: 'orders', series_type: 'line', y_axis: side },
			]),
			'YAxis',
		);
		expect(axes).toHaveLength(1);
		expect(axes[0].props.yAxisId).toBe(side);
	});

	it('resolves the right (line) axis with the same logic as the left, deferring to Recharts', () => {
		const axes = findChartElements(combo(LEFT_BAR_RIGHT_LINE), 'YAxis');
		const right = axes.find((a) => a.props.yAxisId === 'right');
		const left = axes.find((a) => a.props.yAxisId === 'left');
		expect(right?.props.domain).toBeUndefined();
		expect(left?.props.domain).toBeUndefined();
	});

	it('applies independent axis labels and manual right-axis bounds', () => {
		const chart = combo(LEFT_BAR_RIGHT_LINE, {
			yAxisLabel: 'Revenue',
			yAxisRightLabel: 'Orders',
			yAxisRightMin: 0,
			yAxisRightMax: 100,
		});
		const axes = findChartElements(chart, 'YAxis');
		const right = axes.find((a) => a.props.yAxisId === 'right');
		const left = axes.find((a) => a.props.yAxisId === 'left');
		expect(left?.props.label?.value).toBe('Revenue');
		expect(right?.props.label?.value).toBe('Orders');
		expect(right?.props.domain).toEqual([0, 100]);
	});

	it('isolates gradient ids per chart via idPrefix', () => {
		const series: SeriesConfig[] = [
			{ data_key: 'revenue', series_type: 'bar' },
			{ data_key: 'orders', series_type: 'area', y_axis: 'right' },
		];
		const first = findChartElements(combo(series, { idPrefix: 'a' }), 'Area')[0];
		const second = findChartElements(combo(series, { idPrefix: 'b' }), 'Area')[0];
		expect(first.props.fill).not.toBe(second.props.fill);
	});
});
