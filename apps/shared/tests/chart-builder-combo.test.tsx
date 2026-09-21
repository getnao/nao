import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart-builder';
import type { SeriesConfig } from '../src/tools/display-chart';

const data = [
	{ month: '2024-01', revenue: 1000, orders: 12 },
	{ month: '2024-02', revenue: 1500, orders: 18 },
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
		const axes = getByType(
			combo([
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			]),
			'YAxis',
		);
		expect(axes.map((a) => a.props.yAxisId).sort()).toEqual(['left', 'right']);
	});

	it('renders both bar and line series in one chart', () => {
		const chart = combo([
			{ data_key: 'revenue', series_type: 'bar' },
			{ data_key: 'orders', series_type: 'line' },
		]);
		expect(getByType(chart, 'Bar')).toHaveLength(1);
		expect(getByType(chart, 'Line')).toHaveLength(1);
	});

	it('keeps a single (left) Y-axis when every series stays on the left', () => {
		const axes = getByType(
			combo([
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'left' },
			]),
			'YAxis',
		);
		expect(axes).toHaveLength(1);
		expect(axes[0].props.yAxisId).toBe('left');
	});

	it('does not draw an empty left axis when all series are on the right', () => {
		const axes = getByType(
			combo([
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'right' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			]),
			'YAxis',
		);
		expect(axes).toHaveLength(1);
		expect(axes[0].props.yAxisId).toBe('right');
	});

	it('resolves the right (line) axis with the same logic as the left, deferring to Recharts', () => {
		const axes = getByType(
			combo([
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			]),
			'YAxis',
		);
		const right = axes.find((a) => a.props.yAxisId === 'right');
		const left = axes.find((a) => a.props.yAxisId === 'left');
		expect(right?.props.domain).toBeUndefined();
		expect(left?.props.domain).toBeUndefined();
	});

	it('applies independent axis labels and manual right-axis bounds', () => {
		const chart = combo(
			[
				{ data_key: 'revenue', series_type: 'bar', y_axis: 'left' },
				{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
			],
			{ yAxisLabel: 'Revenue', yAxisRightLabel: 'Orders', yAxisRightMin: 0, yAxisRightMax: 100 },
		);
		const axes = getByType(chart, 'YAxis');
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
		const first = getByType(combo(series, { idPrefix: 'a' }), 'Area')[0];
		const second = getByType(combo(series, { idPrefix: 'b' }), 'Area')[0];
		expect(first.props.fill).not.toBe(second.props.fill);
	});
});

interface ChartElementProps {
	yAxisId?: string;
	domain?: [number, number];
	label?: { value?: string };
	fill?: string;
}

function getByType(chart: ReactElement, displayName: string): ReactElement<ChartElementProps>[] {
	const children = (chart.props as { children?: unknown }).children;
	return flattenChildren(children).filter(
		(child) => (child.type as { displayName?: string })?.displayName === displayName,
	) as ReactElement<ChartElementProps>[];
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
