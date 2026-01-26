import { useMemo } from 'react';
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, XAxis, YAxis } from 'recharts';
import { useToolCallContext } from '../../contexts/tool-call.provider';
import { useAgentContext } from '../../contexts/agent.provider';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '../ui/chart';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { CategoricalChartProps } from 'recharts/types/chart/generateCategoricalChart';
import type { ChartConfig } from '../ui/chart';
import type { displayChartSchemas, executeSqlSchemas } from 'backend/tools';
import { toLabel } from '@/lib/charts.utils';

const DEFAULT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export const DisplayChartToolCall = () => {
	const { toolPart } = useToolCallContext();
	const { messages } = useAgentContext();
	const input = toolPart.state !== 'input-streaming' ? (toolPart.input as displayChartSchemas.Input) : undefined;
	const output = toolPart.state !== 'input-streaming' ? (toolPart.output as displayChartSchemas.Output) : undefined;

	// Find the source execute_sql tool call data
	const sourceData = useMemo(() => {
		if (!input?.query_id) {
			return null;
		}

		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === input.query_id) {
					return part.output as executeSqlSchemas.Output;
				}
			}
		}
		return null;
	}, [messages, input?.query_id]);

	// Build chart config for recharts
	const chartConfig = useMemo((): ChartConfig => {
		if (!input?.series) {
			return {};
		}

		if (input.chart_type === 'pie') {
			if (!sourceData?.data) {
				return {};
			}

			const xValues = new Set(sourceData.data.map((item) => String(item[input.x_axis_key])));
			return [...xValues].reduce(
				(acc, v, index) => {
					acc[v] = {
						label: toLabel(v),
						color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
					};
					return acc;
				},
				{
					[input.x_axis_key]: {
						label: toLabel(input.x_axis_key),
					},
				} as ChartConfig,
			);
		}

		const config: ChartConfig = {};
		input.series.forEach((s, index) => {
			config[s.data_key] = {
				label: toLabel(s.data_key),
				color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
			};
		});
		return config;
	}, [input?.series, input?.x_axis_key, sourceData, input?.chart_type]);

	// TODO: display better components for loading and error states

	if (output && 'error' in output) {
		return (
			<ToolCallWrapper defaultExpanded title={<span>Chart Error</span>}>
				<div className='p-4 text-red-400 text-sm'>{output.error}</div>
			</ToolCallWrapper>
		);
	}

	if (!input) {
		return (
			<ToolCallWrapper defaultExpanded title={<span>Loading chart...</span>}>
				<div className='p-4 text-center text-foreground/50 text-sm'>Loading chart configuration...</div>
			</ToolCallWrapper>
		);
	}

	if (!sourceData) {
		return (
			<ToolCallWrapper defaultExpanded title={<span>{input.title || 'Chart'}</span>}>
				<div className='p-4 text-center text-foreground/50 text-sm'>Waiting for source data...</div>
			</ToolCallWrapper>
		);
	}

	if (!sourceData.data || sourceData.data.length === 0) {
		return (
			<ToolCallWrapper defaultExpanded title={<span>{input.title || 'Chart'}</span>}>
				<div className='p-4 text-center text-foreground/50 text-sm'>No data to display</div>
			</ToolCallWrapper>
		);
	}

	const data = sourceData.data;

	const renderChart = (options: CategoricalChartProps, tooltipOptions: React.ComponentProps<typeof ChartTooltip>) => {
		if (input.chart_type === 'bar' || input.chart_type === 'line') {
			const Chart = input.chart_type === 'bar' ? BarChart : AreaChart;
			return (
				<Chart data={data} accessibilityLayer {...options}>
					<defs>
						{input.series.map((s) => (
							<linearGradient key={s.data_key} id={s.data_key} x1='0' y1='0' x2='0' y2='1'>
								<stop offset='0%' stopColor={`var(--color-${s.data_key})`} stopOpacity={0.5} />
								<stop offset='100%' stopColor={`var(--color-${s.data_key})`} stopOpacity={0} />
							</linearGradient>
						))}
					</defs>

					<ChartTooltip
						{...tooltipOptions}
						content={<ChartTooltipContent labelFormatter={(value) => toLabel(value)} />}
					/>

					<YAxis tickLine={false} axisLine={false} minTickGap={12} />
					<XAxis
						dataKey={input.x_axis_key}
						tickLine={false}
						tickMargin={10}
						axisLine={false}
						minTickGap={12}
						tickFormatter={(value) => toLabel(value)}
					/>

					{input.chart_type === 'bar'
						? input.series.map((s) => (
								<Bar
									key={s.data_key}
									dataKey={s.data_key}
									fill={`var(--color-${s.data_key})`}
									radius={4}
								/>
							))
						: input.series.map((s) => (
								<Area
									key={s.data_key}
									dataKey={s.data_key}
									type='monotone'
									stroke={`var(--color-${s.data_key})`}
									fill={`url(#${s.data_key})`}
								/>
							))}

					<ChartLegend content={<ChartLegendContent />} />
				</Chart>
			);
		}

		if (input.chart_type === 'pie') {
			const dataKey = input.series.at(0)?.data_key;
			if (!dataKey) {
				return null;
			}

			const dataWithColors = data.map((item) => ({
				...item,
				fill: `var(--color-${item[input.x_axis_key]})`,
			}));
			return (
				<PieChart accessibilityLayer>
					<ChartTooltip {...tooltipOptions} content={<ChartTooltipContent />} />
					<Pie
						data={dataWithColors}
						dataKey={dataKey}
						nameKey={input.x_axis_key}
						label={({ name, value }) => `${toLabel(name)}: ${value}`}
						labelLine={false}
					/>
				</PieChart>
			);
		}
		return null;
	};

	const chartContent = renderChart(
		{
			margin: {
				top: 0,
				right: 0,
				bottom: 0,
				left: -18,
			},
		},
		{
			animationDuration: 150,
			animationEasing: 'linear',
			allowEscapeViewBox: {
				y: true,
				x: false,
			},
		},
	);

	if (!chartContent) {
		return <div className='p-4 text-center text-foreground/50 text-sm'>Unknown chart type</div>;
	}

	return (
		<div className='flex flex-col items-center my-4 gap-2'>
			<span className='text-sm font-medium'>{input.title}</span>
			<ChartContainer config={chartConfig} className='min-h-[250px] w-full'>
				{chartContent}
			</ChartContainer>
		</div>
	);
};
