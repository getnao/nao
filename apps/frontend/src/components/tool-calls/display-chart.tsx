import { buildChart, bucketPieData, buildStoryChartBlock, labelize } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Code, Download, FilePlus, Pencil } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import { useOptionalAgentContext } from '../../contexts/agent.provider';
import GraphLoaderAnimated from '../icons/graph-loader-animated';
import { Button } from '../ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import { DisplayChartEditDialog } from './display-chart-edit-dialog';
import { DisplayChartTable } from './display-chart-table';
import { ChartRangeSelector } from './display-chart-range-selector';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { ChartConfig } from '../ui/chart';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import type { DateRange } from '@/lib/charts.utils';
import { trpc } from '@/main';
import { findStoryIds } from '@/lib/story.utils';
import {
	DATE_RANGE_OPTIONS,
	filterByDateRange,
	resolveDataKey,
	resolvePieTooltipLabel,
	sortByDateKey,
	toKey,
} from '@/lib/charts.utils';
import { useDateFormat } from '@/hooks/use-date-format';
import { useChatId } from '@/hooks/use-chat-id';
import { useSidePanel } from '@/contexts/side-panel';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { SidePanelContent } from '@/components/side-panel/sql-editor';

const Colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const EMPTY_MESSAGES: UIMessage[] = [];

export const DisplayChartToolCall = ({
	toolPart: { state, input, output, toolCallId },
}: ToolCallComponentProps<'display_chart'>) => {
	const agent = useOptionalAgentContext();
	const messages = agent?.messages ?? EMPTY_MESSAGES;
	const chatId = useChatId();
	const queryClient = useQueryClient();
	const { open: openSidePanel, currentStorySlug, isVisible } = useSidePanel();
	const config = state !== 'input-streaming' ? input : undefined;
	const chartConfig = config?.chart_type === 'table' ? undefined : config;
	const tableConfig = config?.chart_type === 'table' ? config : undefined;
	const isTableVariant = input?.chart_type === 'table' || config?.chart_type === 'table';
	const [dataRange, setDataRange] = useState<DateRange>('all');
	const storyIds = useMemo(() => findStoryIds(messages), [messages]);
	const normalSize = useMemo(() => (document.querySelector('[data-selection-container]') ? true : false), []);

	const addToStoryMutation = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: (_data, variables) => {
				queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);

	const [isDownloading, setIsDownloading] = useState(false);
	const [isEditOpen, setIsEditOpen] = useState(false);
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning);

	const handleDownload = async () => {
		if (!chartConfig) {
			return;
		}
		setIsDownloading(true);
		try {
			const image = await queryClient.fetchQuery(trpc.chart.download.queryOptions({ toolCallId }));
			const link = document.createElement('a');
			link.download = `${chartConfig.title || 'chart'}.png`;
			link.href = `data:image/png;base64,${image}`;
			link.click();
		} catch (err) {
			console.error('Error downloading chart image:', err);
		} finally {
			setIsDownloading(false);
		}
	};

	const sourceQuery = useMemo<{ input?: executeSql.Input; output: executeSql.Output } | null>(() => {
		if (!chartConfig?.query_id) {
			return null;
		}

		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output && part.output.id === chartConfig.query_id) {
					return { input: part.input, output: part.output };
				}
			}
		}
		return null;
	}, [messages, chartConfig?.query_id]);

	const sourceData = sourceQuery?.output ?? null;

	const handleViewQuery = useCallback(() => {
		if (!sourceQuery?.input || !sourceQuery.output) {
			return;
		}
		openSidePanel(<SidePanelContent input={sourceQuery.input} output={sourceQuery.output} />);
	}, [openSidePanel, sourceQuery]);

	const filteredData = useMemo(() => {
		if (!sourceData?.data || !chartConfig) {
			return [];
		}
		if (chartConfig.x_axis_type !== 'date') {
			return sourceData.data;
		}
		const xAxisKey = resolveDataKey(sourceData.data, chartConfig.x_axis_key);
		const sorted = sortByDateKey(sourceData.data, xAxisKey);
		return filterByDateRange(sorted, xAxisKey, dataRange);
	}, [sourceData?.data, chartConfig, dataRange]);

	if (isTableVariant) {
		return <DisplayChartTable config={tableConfig} outputError={output?.error} toolCallId={toolCallId} />;
	}

	if (output && output.error) {
		return (
			<ToolCallWrapper defaultExpanded title='Could not display the chart'>
				<div className='p-4 text-red-400 text-sm'>{output.error}</div>
			</ToolCallWrapper>
		);
	}

	if (!chartConfig) {
		return (
			<div className='my-4 flex flex-col gap-2 items-center aspect-3/2'>
				<Skeleton className='w-1/2 h-4' />
				<Skeleton className='w-full flex-1 flex flex-col items-center justify-center gap-3'>
					<GraphLoaderAnimated className='w-96 h-64 text-muted-foreground' />
					<TextShimmer text='Loading chart' />
				</Skeleton>
			</div>
		);
	}

	if (chartConfig.series.length === 0) {
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

	const handleAddToStory = async () => {
		const latestStoryId = storyIds[storyIds.length - 1];
		// Prefer the currently-visible story slug, but only if it's a real story
		// from this chat — the side panel's currentStorySlug can lag behind (e.g.
		// it was set from a partial streamed slug during the story tool's
		// input-streaming phase) and would otherwise point to a non-existent
		// story.
		const targetId =
			isVisible && currentStorySlug && storyIds.includes(currentStorySlug) ? currentStorySlug : latestStoryId;
		if (!targetId || !chartConfig || !chatId) {
			return;
		}

		const data = await queryClient.fetchQuery({
			...trpc.story.listVersions.queryOptions({ chatId, storySlug: targetId }),
			staleTime: 0,
		});
		const latest = data.versions.at(-1);
		if (!latest) {
			return;
		}

		const chartBlock = buildStoryChartBlock(chartConfig);
		const newCode = latest.code.trimEnd() + '\n\n' + chartBlock;

		addToStoryMutation.mutate({
			chatId,
			storySlug: targetId,
			title: data.title,
			code: newCode,
			action: 'update',
		});

		if (!isVisible) {
			openSidePanel(<StoryViewer chatId={chatId} storySlug={targetId} />, targetId);
		}
	};

	return (
		<div
			className={`flex flex-col items-stretch w-full my-4 gap-4 ${chartConfig.chart_type !== 'kpi_card' && !normalSize ? 'aspect-3/2' : ''}`}
		>
			<div className='flex w-full items-center justify-between gap-2'>
				{chartConfig.chart_type != 'kpi_card' ? (
					<span className='text-sm font-medium text-foreground flex-1'>{chartConfig.title}</span>
				) : (
					<div></div>
				)}
				<div className='flex items-center gap-1'>
					{storyIds.length > 0 && (
						<Button
							variant='outline'
							className='rounded-full border gap-2 dark:bg-transparent'
							size='sm'
							onClick={handleAddToStory}
						>
							<FilePlus className='size-3' />
							<span className='text-xs'>Add to story</span>
						</Button>
					)}
					{!displayChart.isPieChart(chartConfig.chart_type) && chartConfig.x_axis_type === 'date' && (
						<ChartRangeSelector
							options={DATE_RANGE_OPTIONS}
							selectedRange={dataRange}
							onRangeSelected={(range) => setDataRange(range)}
						/>
					)}
					{sourceQuery?.input && (
						<Button
							variant='ghost'
							size='icon-xs'
							className='hover:rounded-full'
							onClick={handleViewQuery}
							title='View SQL query and data'
						>
							<Code className='size-4' />
						</Button>
					)}
					{chartConfig.chart_type != 'kpi_card' && (
						<Button
							variant='ghost'
							size='icon-xs'
							className='hover:rounded-full'
							onClick={handleDownload}
							disabled={isDownloading}
							title='Download as PNG'
						>
							<Download className='size-4' />
						</Button>
					)}
					{isEditable && (
						<Button
							variant='ghost'
							size='icon-xs'
							className='hover:rounded-full'
							onClick={() => setIsEditOpen(true)}
							title='Edit chart'
						>
							<Pencil className='size-4' />
						</Button>
					)}
				</div>
			</div>

			{isEditable && (
				<DisplayChartEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					toolCallId={toolCallId}
					config={chartConfig}
					availableColumns={sourceData.columns ?? []}
				/>
			)}

			<ChartDisplay
				data={filteredData}
				chartType={chartConfig.chart_type}
				xAxisKey={chartConfig.x_axis_key}
				series={chartConfig.series}
				xAxisType={chartConfig.x_axis_type === 'number' ? 'number' : 'category'}
				title={chartConfig.title}
				yAxisMin={chartConfig.y_axis_min}
				yAxisMax={chartConfig.y_axis_max}
				showDataLabels={chartConfig.show_data_labels}
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
	yAxisMin?: number;
	yAxisMax?: number;
	showDataLabels?: boolean;
}

export const ChartDisplay = memo(function ChartDisplay({
	data,
	chartType,
	xAxisKey: xAxisKeyProp,
	xAxisType,
	xAxisLabelFormatter,
	series: seriesProp,
	title,
	showGrid = true,
	yAxisMin,
	yAxisMax,
	showDataLabels,
}: ChartDisplayProps) {
	const dateFormat = useDateFormat();

	const xAxisKey = useMemo(() => resolveDataKey(data, xAxisKeyProp), [data, xAxisKeyProp]);
	const series = useMemo(
		() => seriesProp.map((s) => ({ ...s, data_key: resolveDataKey(data, s.data_key) })),
		[data, seriesProp],
	);

	const { visibleSeries, hiddenSeriesKeys, handleToggleSeriesVisibility } = useSeriesVisibility(series);
	const isPercentStacked = displayChart.isPercentStackedChartType(chartType);

	const isPie = displayChart.isPieChart(chartType);
	const pieValueKey = series[0]?.data_key ?? '';
	const pieData = useMemo(
		() => (isPie ? bucketPieData(data, xAxisKey, pieValueKey) : data),
		[isPie, data, xAxisKey, pieValueKey],
	);

	const chartConfig = useMemo((): ChartConfig => {
		if (isPie) {
			return pieData.reduce<ChartConfig>(
				(acc, item, index) => {
					const category = String(item[xAxisKey]);
					acc[toKey(category)] = {
						label: labelize(category, dateFormat),
						color: Colors[index % Colors.length],
					};
					return acc;
				},
				{
					[xAxisKey]: {
						label: labelize(xAxisKey, dateFormat),
					},
				},
			);
		}

		return series.reduce((acc, s, idx) => {
			acc[s.data_key] = {
				label: s.label || labelize(s.data_key, dateFormat),
				color: s.color || Colors[idx % Colors.length],
				isTotal: s.is_total,
			};
			return acc;
		}, {} as ChartConfig);
	}, [series, xAxisKey, pieData, isPie, dateFormat]);

	const colorFor = useMemo(
		() =>
			isPie
				? (value: string, _i: number) => `var(--color-${toKey(value)})`
				: (dataKey: string, _i: number) => `var(--color-${dataKey})`,
		[isPie],
	);

	const legendPayload = useMemo(() => {
		if (isPie) {
			return pieData.map((item, index) => {
				const category = String(item[xAxisKey]);
				return {
					value: category,
					dataKey: toKey(category),
					color: Colors[index % Colors.length],
					isHidden: false,
				};
			});
		}
		return series.map((s, idx) => ({
			value: s.label || labelize(s.data_key, dateFormat),
			dataKey: s.data_key,
			color: s.color || Colors[idx % Colors.length],
			isHidden: hiddenSeriesKeys.has(s.data_key),
		}));
	}, [isPie, pieData, xAxisKey, series, hiddenSeriesKeys, dateFormat]);

	const labelFormatter = useMemo(
		() => xAxisLabelFormatter ?? ((value: string) => labelize(value, dateFormat)),
		[xAxisLabelFormatter, dateFormat],
	);

	const tooltipLabelFormatter = useMemo(
		() => (value: unknown, items: unknown) =>
			isPie
				? labelize(resolvePieTooltipLabel(items as { name?: unknown }[]), dateFormat)
				: labelize(value as string, dateFormat),
		[isPie, dateFormat],
	);

	const chartElement = useMemo(
		() =>
			buildChart({
				data: pieData,
				chartType,
				xAxisKey,
				xAxisType,
				series: visibleSeries,
				colorFor,
				labelFormatter,
				showGrid,
				showDataLabels,
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				yAxisMin,
				yAxisMax,
				children: [
					<ChartTooltip
						key='tooltip'
						animationDuration={150}
						animationEasing='linear'
						allowEscapeViewBox={{ y: true, x: false }}
						content={
							<ChartTooltipContent percent={isPercentStacked} labelFormatter={tooltipLabelFormatter} />
						}
					/>,
					chartType !== 'kpi_card' && (
						<ChartLegend
							key='legend'
							payload={legendPayload}
							layout={isPie ? 'vertical' : 'horizontal'}
							align={isPie ? 'right' : 'center'}
							verticalAlign={isPie ? 'middle' : 'bottom'}
							content={
								<ChartLegendContent
									layout={isPie ? 'vertical' : 'horizontal'}
									onItemClick={isPie ? undefined : handleToggleSeriesVisibility}
								/>
							}
						/>
					),
				],
				title,
				renderTitle: false,
			}),
		[
			pieData,
			chartType,
			isPie,
			xAxisKey,
			xAxisType,
			visibleSeries,
			colorFor,
			labelFormatter,
			tooltipLabelFormatter,
			showGrid,
			yAxisMin,
			yAxisMax,
			showDataLabels,
			legendPayload,
			handleToggleSeriesVisibility,
			title,
			isPercentStacked,
		],
	);

	return (
		<div className='flex flex-col items-stretch gap-2 w-full'>
			{chartType === 'kpi_card' ? (
				chartElement
			) : (
				<ChartContainer config={chartConfig} className='w-full'>
					{chartElement}
				</ChartContainer>
			)}
		</div>
	);
});

/** Manages which series are visible and hidden */
const useSeriesVisibility = (series: displayChart.SeriesConfig[]) => {
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());

	const visibleSeries = useMemo(
		() => series.filter((s) => !hiddenSeriesKeys.has(s.data_key)),
		[series, hiddenSeriesKeys],
	);

	const handleToggleSeriesVisibility = useCallback((dataKey: string) => {
		setHiddenSeriesKeys((prev) => {
			const copy = new Set(prev);
			if (copy.has(dataKey)) {
				copy.delete(dataKey);
			} else {
				copy.add(dataKey);
			}
			return copy;
		});
	}, []);

	return {
		visibleSeries,
		hiddenSeriesKeys,
		handleToggleSeriesVisibility,
	};
};
