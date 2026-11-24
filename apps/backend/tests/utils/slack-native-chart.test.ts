import { cardToBlockKit } from '@chat-adapter/slack';
import { Card, CardText } from 'chat';
import { describe, expect, it } from 'vitest';

import {
	buildSlackNativeChart,
	hasRoomForSlackNativeChart,
	type SlackNativeChartInput,
} from '../../src/utils/slack-native-chart';

const monthlyRevenue = [
	{ month: 'jan', revenue: 120, cost: 80 },
	{ month: 'feb', revenue: '150.5', cost: 90 },
	{ month: 'mar', revenue: 180, cost: 95 },
];

function barChart(overrides: Partial<SlackNativeChartInput['config']> = {}): SlackNativeChartInput['config'] {
	return {
		chart_type: 'bar',
		title: 'Revenue by month',
		x_axis_key: 'month',
		x_axis_type: 'category',
		series: [{ data_key: 'revenue' }, { data_key: 'cost', label: 'Costs' }],
		...overrides,
	};
}

describe('buildSlackNativeChart', () => {
	it('maps a bar chart to Slack series with one point per category', () => {
		const chart = buildSlackNativeChart({ config: barChart({ y_axis_label: 'USD' }), data: monthlyRevenue });

		expect(chart).toEqual({
			type: 'chart',
			title: 'Revenue by month',
			chart: {
				type: 'bar',
				categories: ['Jan', 'Feb', 'Mar'],
				series: [
					{
						name: 'Revenue',
						data: [
							{ label: 'Jan', value: 120 },
							{ label: 'Feb', value: 150.5 },
							{ label: 'Mar', value: 180 },
						],
					},
					{
						name: 'Costs',
						data: [
							{ label: 'Jan', value: 80 },
							{ label: 'Feb', value: 90 },
							{ label: 'Mar', value: 95 },
						],
					},
				],
				xLabel: undefined,
				yLabel: 'USD',
			},
		});
	});

	it('renders as a Slack data_visualization block', () => {
		const chart = buildSlackNativeChart({ config: barChart(), data: monthlyRevenue });

		const blocks = cardToBlockKit(Card({ children: [chart!] }));

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ type: 'data_visualization', title: 'Revenue by month' });
	});

	it('sorts date axes chronologically', () => {
		const data = [
			{ day: '2026-03-01', orders: 3 },
			{ day: '2026-01-01', orders: 1 },
		];
		const chart = buildSlackNativeChart({
			config: barChart({
				chart_type: 'line',
				x_axis_key: 'day',
				x_axis_type: 'date',
				series: [{ data_key: 'orders' }],
			}),
			data,
		});

		expect(chart?.chart.type === 'line' && chart.chart.series[0].data.map((point) => point.value)).toEqual([1, 3]);
	});

	it('maps donut charts to pie segments and groups the tail into Other', () => {
		const data = Array.from({ length: 15 }, (_, index) => ({ country: `country_${index}`, users: 100 - index }));
		const chart = buildSlackNativeChart({
			config: barChart({ chart_type: 'donut', x_axis_key: 'country', series: [{ data_key: 'users' }] }),
			data,
		});

		expect(chart?.chart.type).toBe('pie');
		const segments = chart?.chart.type === 'pie' ? chart.chart.segments : [];
		expect(segments).toHaveLength(12);
		expect(segments.at(-1)).toEqual({ label: 'Other', value: 86 + 87 + 88 + 89 });
	});

	it('drops empty pie slices', () => {
		const chart = buildSlackNativeChart({
			config: barChart({ chart_type: 'pie', series: [{ data_key: 'revenue' }] }),
			data: [
				{ month: 'jan', revenue: 10 },
				{ month: 'feb', revenue: 0 },
			],
		});

		expect(chart?.chart.type === 'pie' && chart.chart.segments).toEqual([{ label: 'Jan', value: 10 }]);
	});

	it('truncates long titles and labels to Slack limits', () => {
		const chart = buildSlackNativeChart({
			config: barChart({ title: 'A'.repeat(60), series: [{ data_key: 'revenue' }] }),
			data: [{ month: 'a very long category label', revenue: 1 }],
		});

		expect(chart?.title).toHaveLength(50);
		expect(chart?.chart.type === 'bar' && chart.chart.categories).toEqual(['A Very Long Categor…']);
	});

	it('moves a shared unit to the value axis title', () => {
		const withUnit = (y_axis_label?: string) =>
			buildSlackNativeChart({
				config: barChart({
					y_axis_label,
					series: [
						{ data_key: 'revenue', value_format: { prefix: '$', d3_format: ',.2f' } },
						{ data_key: 'cost', value_format: { prefix: '$' } },
					],
				}),
				data: monthlyRevenue,
			});

		expect(withUnit('Amount')?.chart).toMatchObject({ yLabel: 'Amount ($)' });
		expect(withUnit()?.chart).toMatchObject({ yLabel: '$' });
		expect(withUnit('A'.repeat(60))?.chart).toMatchObject({ yLabel: `${'A'.repeat(45)}… ($)` });
	});

	it.each([
		['an unsupported chart type', { config: barChart({ chart_type: 'stacked_bar' }), data: monthlyRevenue }],
		['a missing title', { config: barChart({ title: undefined }), data: monthlyRevenue }],
		['no rows', { config: barChart(), data: [] }],
		[
			'more than 20 categories',
			{
				config: barChart(),
				data: Array.from({ length: 21 }, (_, i) => ({ month: `m${i}`, revenue: i, cost: i })),
			},
		],
		['a null value', { config: barChart(), data: [{ month: 'jan', revenue: null, cost: 1 }] }],
		[
			'labels that collide once truncated',
			{
				config: barChart({ series: [{ data_key: 'revenue' }] }),
				data: [
					{ month: 'category label number one', revenue: 1 },
					{ month: 'category label number two', revenue: 2 },
				],
			},
		],
		[
			'duplicate series names',
			{
				config: barChart({ series: [{ data_key: 'revenue' }, { data_key: 'cost', label: 'Revenue' }] }),
				data: monthlyRevenue,
			},
		],
		[
			'a negative pie value',
			{
				config: barChart({ chart_type: 'pie', series: [{ data_key: 'revenue' }] }),
				data: [{ month: 'jan', revenue: -1 }],
			},
		],
		[
			'a numeric x axis, which Slack would space evenly',
			{ config: barChart({ chart_type: 'line', x_axis_type: 'number' }), data: monthlyRevenue },
		],
		[
			'pie labels that collide once truncated',
			{
				config: barChart({ chart_type: 'pie', series: [{ data_key: 'revenue' }] }),
				data: [
					{ month: 'category label number one', revenue: 1 },
					{ month: 'category label number two', revenue: 2 },
				],
			},
		],
		[
			'a value too large for a number',
			{ config: barChart({ series: [{ data_key: 'revenue' }] }), data: [{ month: 'jan', revenue: 10n ** 400n }] },
		],
		[
			'series with different units',
			{
				config: barChart({
					series: [
						{ data_key: 'revenue', value_format: { prefix: '$' } },
						{ data_key: 'cost', value_format: { suffix: '%' } },
					],
				}),
				data: monthlyRevenue,
			},
		],
		[
			'a pie with a unit, which has no axis to carry it',
			{
				config: barChart({
					chart_type: 'pie',
					series: [{ data_key: 'revenue', value_format: { suffix: '%' } }],
				}),
				data: monthlyRevenue,
			},
		],
	])('falls back to an image for %s', (_, input) => {
		expect(buildSlackNativeChart(input as SlackNativeChartInput)).toBeNull();
	});
});

describe('hasRoomForSlackNativeChart', () => {
	it('allows at most two native charts per Slack message', () => {
		const chart = buildSlackNativeChart({ config: barChart(), data: monthlyRevenue })!;

		expect(hasRoomForSlackNativeChart([CardText('intro'), chart])).toBe(true);
		expect(hasRoomForSlackNativeChart([chart, CardText('between'), chart])).toBe(false);
	});
});
