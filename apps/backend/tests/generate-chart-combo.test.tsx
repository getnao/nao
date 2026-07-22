import type { displayChart } from '@nao/shared/tools';
import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../src/components/generate-chart';

const data = [
	{ month: '2024-01', revenue: 1000, orders: 12 },
	{ month: '2024-02', revenue: 1500, orders: 18 },
];

function render(
	config: Partial<Parameters<typeof renderChartToSvg>[0]['config']> & { series: displayChart.SeriesConfig[] },
) {
	return renderChartToSvg({
		config: {
			chart_type: 'mixed',
			x_axis_key: 'month',
			x_axis_type: 'category',
			title: 'Test',
			...config,
		},
		data,
	});
}

function countYAxes(svg: string): number {
	return (svg.match(/recharts-yAxis/g) ?? []).length;
}

describe('renderChartToSvg (combo)', () => {
	it('renders mixed bar and line series', () => {
		const svg = render({
			series: [
				{ data_key: 'revenue', series_type: 'bar' },
				{ data_key: 'orders', series_type: 'line' },
			],
		});
		expect(svg).toContain('recharts-bar');
		expect(svg).toContain('recharts-line');
	});

	it('draws a second Y-axis when a series uses the right axis', () => {
		const svg = render({
			series: [
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			],
		});
		expect(countYAxes(svg)).toBe(2);
	});

	it('keeps a single Y-axis when every series stays on the left', () => {
		const svg = render({
			series: [
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'left' },
			],
		});
		expect(countYAxes(svg)).toBe(1);
	});

	it('renders independent axis labels', () => {
		const svg = render({
			series: [
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			],
			y_axis_label: 'Revenue',
			y_axis_right_label: 'Orders',
		});
		expect(svg).toContain('Revenue');
		expect(svg).toContain('Orders');
	});
});
