import { useMemo, useState } from 'react';
import { buildChart, labelize } from '@nao/shared';
import { Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentContext } from '../../contexts/agent.provider';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '../ui/chart';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { ToolCallWrapper } from './tool-call-wrapper';
import { ChartRangeSelector } from './display-chart-range-selector';
import type { ToolCallComponentProps } from '.';
import type { ChartConfig } from '../ui/chart';
import type { displayChart } from '@nao/shared/tools';
import type { DateRange } from '@/lib/charts.utils';
import { trpc } from '@/main';
import { filterByDateRange, DATE_RANGE_OPTIONS, toKey } from '@/lib/charts.utils';

const Colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export const DisplayChartToolCall = ({
	toolPart: { state, input, output, toolCallId },
}: ToolCallComponentProps<'display_chart'>) => {
	const { messages } = useAgentContext();
	const config = state !== 'input-streaming' ? input : undefined;
	const [dataRange, setDataRange] = useState<DateRange>('all');

	const queryClient = useQueryClient();
	const [isDownloading, setIsDownloading] = useState(false);

	const handleDownload = async () => {
		if (!config) {
			return;
		}
		setIsDownloading(true);
		try {
			const image = await queryClient.fetchQuery(trpc.chart.download.queryOptions({ toolCallId }));
			const link = document.createElement('a');
			link.download = `${config.title || 'chart'}.png`;
			link.href = `data:image/png;base64,${image}`;
			link.click();
		} catch (err) {
			console.error('Error downloading chart image:', err);
		} finally {
			setIsDownloading(false);
		}
	};

	const sourceData = useMemo(() => {
		if (!config?.query_id) {
			return null;
		}

		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === config.query_id) {
					return part.output;
				}
			}
		}
		return null;
	}, [messages, config?.query_id]);

	const filteredData = useMemo(() => {
		if (!sourceData?.data || !config) {
			return [];
		}
		if (config.x_axis_type !== 'date') {
			return sourceData.data;
		}
		return filterByDateRange(sourceData.data, config.x_axis_key, dataRange);
	}, [sourceData?.data, config, dataRange]);

	if (output && output.error) {
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
			<div className='relative w-full flex justify-end'>
				<div className='flex items-center gap-1'>
					{config.chart_type !== 'pie' && config.x_axis_type === 'date' && (
						<ChartRangeSelector
							options={DATE_RANGE_OPTIONS}
							selectedRange={dataRange}
							onRangeSelected={(range) => setDataRange(range)}
						/>
					)}
					<Button
						variant='ghost-muted'
						size='icon-xs'
						onClick={handleDownload}
						disabled={isDownloading}
						title='Download as PNG'
					>
						<Download className='size-3.5' />
					</Button>
				</div>
			</div>

			<ChartDisplay
				data={filteredData}
				chartType={config.chart_type}
				xAxisKey={config.x_axis_key}
				series={config.series}
				xAxisType={config.x_axis_type === 'number' ? 'number' : 'category'}
				title={config.title}
			/>
		</div>
	);
};

export interface ChartDisplayProps {
	data: Record<string, unknown>[];
	chartType: displayChart.ChartType;
	xAxisKey: string;
	xAxisType: 'number' | 'category';
	xAxisLabelFormatter?: (value: string) => string;
	series: displayChart.SeriesConfig[];
	title?: string;
	showGrid?: boolean;
}

export const ChartDisplay = ({
	data,
	chartType,
	xAxisKey,
	xAxisType,
	xAxisLabelFormatter,
	series,
	title,
	showGrid = true,
}: ChartDisplayProps) => {
	const { visibleSeries, hiddenSeriesKeys, handleToggleSeriesVisibility } = useSeriesVisibility(series);

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
				label: s.label || labelize(s.data_key),
				color: s.color || Colors[idx % Colors.length],
			};
			return acc;
		}, {} as ChartConfig);
	}, [series, xAxisKey, data, chartType]);

	const colorFor =
		chartType === 'pie'
			? (value: string, _i: number) => `var(--color-${toKey(value)})`
			: (dataKey: string, _i: number) => `var(--color-${dataKey})`;

	const legendPayload = series.map((s, idx) => ({
		value: s.label || labelize(s.data_key),
		dataKey: s.data_key,
		color: s.color || Colors[idx % Colors.length],
		isHidden: hiddenSeriesKeys.has(s.data_key),
	}));

	const chartElement = buildChart({
		data,
		chartType,
		xAxisKey,
		xAxisType,
		series: visibleSeries,
		colorFor,
		labelFormatter: xAxisLabelFormatter,
		showGrid,
		margin: { top: 0, right: 0, bottom: 0, left: -18 },
		children: [
			<ChartTooltip
				key='tooltip'
				animationDuration={150}
				animationEasing='linear'
				allowEscapeViewBox={{ y: true, x: false }}
				content={<ChartTooltipContent labelFormatter={(value) => labelize(value)} />}
			/>,
			chartType !== 'pie' && (
				<ChartLegend
					key='legend'
					payload={legendPayload}
					content={<ChartLegendContent onItemClick={handleToggleSeriesVisibility} />}
				/>
			),
		],
		title,
	});

	return (
		<div className='flex flex-col items-center gap-2 w-full'>
			<ChartContainer config={chartConfig} className='w-full'>
				{chartElement}
			</ChartContainer>
		</div>
	);
};

/** Manages which series are visible and hidden */
const useSeriesVisibility = (series: displayChart.SeriesConfig[]) => {
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());

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
