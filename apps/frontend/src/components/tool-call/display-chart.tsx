import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, XAxis, YAxis } from 'recharts';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { useAgentContext } from '../../contexts/agent.provider';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '../ui/chart';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { ToolCallWrapper } from './tool-call-wrapper';
import { ChartRangeSelector } from './display-chart-range-selector';
import type { CategoricalChartProps } from 'recharts/types/chart/generateCategoricalChart';
import type { ChartConfig } from '../ui/chart';
import type { displayChartSchemas, executeSqlSchemas } from '@nao/backend/tools';
import type { DateRange } from '@/lib/charts.utils';
import { labelize, filterByDateRange, DATE_RANGE_OPTIONS, toKey } from '@/lib/charts.utils';

const Colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export const DisplayChartToolCall = () => {
	const { toolPart } = useToolCallContext();
	const { messages } = useAgentContext();
	const config = toolPart.state !== 'input-streaming' ? (toolPart.input as displayChartSchemas.Input) : undefined;
	const output = toolPart.state !== 'input-streaming' ? (toolPart.output as displayChartSchemas.Output) : undefined;
	const [dataRange, setDataRange] = useState<DateRange>('all');

	const sourceData = useMemo(() => {
		if (!config?.query_id) {
			return null;
		}

		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === config.query_id) {
					return part.output as executeSqlSchemas.Output;
				}
			}
		}
		return null;
	}, [messages, config?.query_id]);

	const filteredData = useMemo(() => {
		if (!sourceData?.data || !config) {
			return [];
		}
		return filterByDateRange(sourceData.data, config.x_axis_key, dataRange);
	}, [sourceData?.data, config, dataRange]);

	if (output && 'error' in output) {
		return (
			<ToolCallWrapper defaultExpanded title='Could not display the chart'>
				<div className='p-4 text-red-400 text-sm'>{output.error}</div>
			</ToolCallWrapper>
		);
	}

	if (!config) {
		return (
			<div className='my-4 flex flex-col gap-2 items-center aspect-3/2'>
				<Skeleton className='w-1/2 h-4' />
				<Skeleton className='w-full flex-1 flex items-center justify-center gap-2'>
					<TextShimmer text='Loading chart' />
				</Skeleton>
			</div>
		);
	}

	if (config.series.length === 0) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the chart because no series are configured.
			</div>
		);
	}

	if (!sourceData) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the chart because the data is missing.
			</div>
		);
	}

	if (!sourceData.data || sourceData.data.length === 0) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the chart because the data is empty.
			</div>
		);
	}

	return (
		<div className='flex flex-col items-center my-4 gap-2 aspect-3/2'>
			<span className='text-sm font-medium'>{config.title}</span>
			{config.chart_type !== 'pie' && config.x_axis_type === 'date' && (
				<div className='flex w-full justify-end items-center'>
					<ChartRangeSelector
						options={DATE_RANGE_OPTIONS}
						selectedRange={dataRange}
						onRangeSelected={(range) => setDataRange(range)}
					/>
				</div>
			)}

			<ChartDisplay
				data={filteredData}
				chartType={config.chart_type}
				xAxisKey={config.x_axis_key}
				series={config.series}
				xAxisType={config.x_axis_type === 'number' ? 'number' : 'category'}
			/>
		</div>
	);
};

export interface ChartDisplayProps {
	data: Record<string, unknown>[];
	chartType: displayChartSchemas.ChartType;
	xAxisKey: string;
	xAxisType: 'number' | 'category';
	/** Minimum one series is required */
	series: displayChartSchemas.SeriesConfig[];
	title?: string;
}

export const ChartDisplay = ({ data, chartType, xAxisKey, xAxisType, series, title }: ChartDisplayProps) => {
	const { visibleSeries, hiddenSeriesKeys, handleToggleSeriesVisibility } = useSeriesVisibility(series);

	/** Recharts config for series labels and colors */
	const chartConfig = useMemo((): ChartConfig => {
		if (chartType === 'pie') {
			const values = new Set(data.map((item) => String(item[xAxisKey])));
			return [...values].reduce(
				(acc, v, index) => {
					acc[toKey(v)] = {
						label: labelize(v),
						color: Colors[index % Colors.length],
					};
					return acc;
				},
				{
					[xAxisKey]: {
						label: labelize(xAxisKey),
					},
				} as ChartConfig,
			);
		}

		return series.reduce((acc, s, idx) => {
			acc[s.data_key] = {
				label: labelize(s.data_key),
				color: s.color || Colors[idx % Colors.length],
			};
			return acc;
		}, {} as ChartConfig);
	}, [series, xAxisKey, data, chartType]);

	const renderChart = (opts: {
		chart: CategoricalChartProps;
		tooltip: React.ComponentProps<typeof ChartTooltip>;
	}) => {
		if (chartType === 'bar' || chartType === 'line') {
			const Chart = chartType === 'bar' ? BarChart : AreaChart;
			const legendPayload = series.map((s, idx) => ({
				value: labelize(s.data_key),
				dataKey: s.data_key,
				color: s.color || Colors[idx % Colors.length],
				isHidden: hiddenSeriesKeys.has(s.data_key),
			}));

			return (
				<Chart data={data} accessibilityLayer {...opts}>
					<defs>
						{visibleSeries.map((s) => (
							<linearGradient key={s.data_key} id={s.data_key} x1='0' y1='0' x2='0' y2='1'>
								<stop offset='0%' stopColor={`var(--color-${s.data_key})`} stopOpacity={0.25} />
								<stop offset='100%' stopColor={`var(--color-${s.data_key})`} stopOpacity={0} />
							</linearGradient>
						))}
					</defs>

					<ChartTooltip
						{...opts.tooltip}
						content={<ChartTooltipContent labelFormatter={(value) => labelize(value)} />}
					/>

					<YAxis tickLine={false} axisLine={false} minTickGap={12} />
					<XAxis
						dataKey={xAxisKey}
						type={xAxisType}
						domain={['dataMin', 'dataMax']}
						tickLine={true}
						tickMargin={10}
						axisLine={false}
						minTickGap={12}
						tickFormatter={(value) => labelize(value)}
					/>

					{chartType === 'bar'
						? visibleSeries.map((s) => (
								<Bar
									key={s.data_key}
									dataKey={s.data_key}
									fill={`var(--color-${s.data_key})`}
									radius={4}
									isAnimationActive={false}
								/>
							))
						: visibleSeries.map((s) => (
								<Area
									key={s.data_key}
									dataKey={s.data_key}
									type='monotone'
									stroke={`var(--color-${s.data_key})`}
									fill={`url(#${s.data_key})`}
									isAnimationActive={false}
								/>
							))}

					<ChartLegend
						payload={legendPayload}
						content={<ChartLegendContent onItemClick={handleToggleSeriesVisibility} />}
					/>
				</Chart>
			);
		}

		const dataKey = series[0].data_key;
		const dataWithColors = data.map((item) => ({
			...item,
			fill: `var(--color-${toKey(String(item[xAxisKey]))})`,
		}));
		return (
			<PieChart accessibilityLayer>
				<ChartTooltip {...opts.tooltip} content={<ChartTooltipContent />} />
				<Pie
					data={dataWithColors}
					dataKey={dataKey}
					nameKey={xAxisKey}
					label={({ name, value }) => `${labelize(name)}: ${value}`}
					labelLine={false}
				/>
			</PieChart>
		);
	};

	const chartContent = renderChart({
		chart: {
			margin: {
				top: 0,
				right: 0,
				bottom: 0,
				left: -18,
			},
		},
		tooltip: {
			animationDuration: 150,
			animationEasing: 'linear',
			allowEscapeViewBox: {
				y: true,
				x: false,
			},
		},
	});

	return (
		<div className='flex flex-col items-center gap-2 w-full'>
			{title && <span className='text-sm font-medium'>{title}</span>}
			<ChartContainer config={chartConfig} className='w-full'>
				{chartContent}
			</ChartContainer>
		</div>
	);
};

/** Manages which series are visible and hidden */
const useSeriesVisibility = (series: displayChartSchemas.SeriesConfig[]) => {
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());

	// Keep hidden series keys in sync with the series config
	useEffect(() => {
		setHiddenSeriesKeys(
			(prev) =>
				new Set(
					series.map((s) => (prev.has(s.data_key) ? s.data_key : undefined)).filter((i) => i !== undefined),
				),
		);
	}, [series]);

	const visibleSeries = useMemo(
		() => series.filter((s) => !hiddenSeriesKeys.has(s.data_key)),
		[series, hiddenSeriesKeys],
	);

	const handleToggleSeriesVisibility = (dataKey: string) => {
		setHiddenSeriesKeys((prev) => {
			const copy = new Set(prev);
			if (copy.has(dataKey)) {
				copy.delete(dataKey);
			} else {
				copy.add(dataKey);
			}
			return copy;
		});
	};

	return {
		visibleSeries,
		hiddenSeriesKeys,
		handleToggleSeriesVisibility,
	};
};
