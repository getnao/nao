import React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Customized, Pie, PieChart, XAxis, YAxis } from 'recharts';

import type * as displayChart from './tools/display-chart';

export const DEFAULT_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea'];

export function labelize(key: unknown): string {
	const str = String(key);
	if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
		const date = new Date(str);
		if (!isNaN(date.getTime())) {
			return date.toLocaleDateString('en-US', { timeZone: 'UTC' });
		}
	}
	return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function defaultColorFor(_key: string, index: number): string {
	return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export interface BuildChartProps {
	data: Record<string, unknown>[];
	chartType: displayChart.ChartType;
	xAxisKey: string;
	xAxisType?: 'number' | 'category';
	series: displayChart.SeriesConfig[];
	colorFor?: (key: string, index: number) => string;
	labelFormatter?: (value: string) => string;
	showGrid?: boolean;
	children?: React.ReactNode[];
	margin?: { top?: number; right?: number; bottom?: number; left?: number };
	title?: string;
}

/**
 * Builds a Recharts element tree from a display_chart tool config.
 *
 * Used by both the frontend (wrapped in ChartContainer + tooltips) and the
 * backend (rendered to SVG via renderToStaticMarkup for image generation).
 */
export function buildChart(props: BuildChartProps) {
	const resolved = buildResolved(props);

	if (resolved.chartType === 'pie') {
		return buildPieChart(resolved);
	}
	if (resolved.chartType === 'line') {
		return buildAreaChart(resolved);
	}
	return buildBarChart(resolved);
}

function buildResolved(props: BuildChartProps) {
	const colorFor = props.colorFor ?? defaultColorFor;
	const labelFormatter = props.labelFormatter ?? ((v: string) => labelize(v));

	const titleChild = props.title ? (
		<Customized
			key='chart-title'
			component={({ width = 0 }: { width?: number }) => (
				<text
					x={width / 2}
					y={16}
					textAnchor='middle'
					dominantBaseline='middle'
					fontSize={14}
					fontWeight='600'
					fontFamily='system-ui, sans-serif'
					fill='#111827'
				>
					{props.title}
				</text>
			)}
		/>
	) : null;

	const resolved: ResolvedProps = {
		...props,
		colorFor,
		labelFormatter,
		margin: props.title ? { ...props.margin, top: (props.margin?.top ?? 0) + 30 } : props.margin,
		children: titleChild ? [titleChild, ...(props.children ?? [])] : props.children,
	};
	return resolved;
}

type ResolvedProps = BuildChartProps & Required<Pick<BuildChartProps, 'colorFor' | 'labelFormatter'>>;

function buildBarChart(props: ResolvedProps) {
	const { data, chartType, xAxisKey, xAxisType, series, colorFor, labelFormatter, showGrid, children, margin } =
		props;
	const isStacked = chartType === 'stacked_bar';

	return (
		<BarChart data={data} accessibilityLayer margin={margin}>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis tickLine={false} axisLine={false} minTickGap={12} />
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tickLine={true}
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				tickFormatter={labelFormatter}
			/>
			{children}
			{series.map((s, i) => (
				<Bar
					key={s.data_key}
					dataKey={s.data_key}
					fill={colorFor(s.data_key, i)}
					stackId={isStacked ? 'stack' : undefined}
					radius={isStacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 4, 4]}
					isAnimationActive={false}
				/>
			))}
		</BarChart>
	);
}

function buildAreaChart(props: ResolvedProps) {
	const { data, xAxisKey, xAxisType, series, colorFor, labelFormatter, showGrid, children, margin } = props;
	return (
		<AreaChart data={data} accessibilityLayer margin={margin}>
			<defs>
				{series.map((s, i) => {
					const color = colorFor(s.data_key, i);
					const gradientId = `grad-${i}`;
					return (
						<linearGradient key={s.data_key} id={gradientId} x1='0' y1='0' x2='0' y2='1'>
							<stop offset='0%' stopColor={color} stopOpacity={0.25} />
							<stop offset='100%' stopColor={color} stopOpacity={0} />
						</linearGradient>
					);
				})}
			</defs>
			{showGrid && <CartesianGrid horizontal vertical={false} strokeDasharray='3 3' />}
			<YAxis tickLine={false} axisLine={false} minTickGap={12} />
			<XAxis
				dataKey={xAxisKey}
				type={xAxisType}
				domain={['dataMin', 'dataMax']}
				tickLine
				tickMargin={10}
				axisLine={false}
				minTickGap={12}
				tickFormatter={labelFormatter}
			/>
			{children}
			{series.map((s, i) => (
				<Area
					key={s.data_key}
					dataKey={s.data_key}
					type='monotone'
					stroke={colorFor(s.data_key, i)}
					fill={`url(#grad-${i})`}
					isAnimationActive={false}
				/>
			))}
		</AreaChart>
	);
}

function buildPieChart(props: ResolvedProps) {
	const { data, xAxisKey, series, colorFor, labelFormatter, children, margin } = props;
	const dataKey = series[0].data_key;

	const uniqueValues = [...new Set(data.map((d) => String(d[xAxisKey])))];
	const colorMap = new Map(uniqueValues.map((v, i) => [v, colorFor(v, i)]));

	const dataWithColors = data.map((item) => ({
		...item,
		fill: colorMap.get(String(item[xAxisKey])) ?? DEFAULT_COLORS[0],
	}));

	return (
		<PieChart accessibilityLayer margin={margin}>
			<Pie
				data={dataWithColors}
				dataKey={dataKey}
				nameKey={xAxisKey}
				label={({ name, value }: { name: string; value: number }) =>
					`${labelFormatter(String(name))}: ${value}`
				}
				labelLine={false}
				isAnimationActive={false}
			/>
			{children}
		</PieChart>
	);
}
