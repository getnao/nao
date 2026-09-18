import { buildChart, bucketPieData, buildStoryChartBlock, labelize, resolveDataKey } from '@nao/shared';
import { appendBlockToStoryCode } from '@nao/shared/story-tabs';
import { displayChart } from '@nao/shared/tools';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
	ChartNoAxesColumn,
	ChevronLeft,
	ChevronRight,
	Code,
	Download,
	FilePlus,
	Pencil,
	Table as TableIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Customized } from 'recharts';

import { useOptionalAgentContext } from '../../contexts/agent.provider';
import GraphLoaderAnimated from '../icons/graph-loader-animated';
import { Button } from '../ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import { DisplayChartEditDialog } from './display-chart-edit-dialog';
import { DisplayChartTable } from './display-chart-table';
import { ChartRangeSelector } from './display-chart-range-selector';
import { CustomChart } from './custom-chart';
import { SqlQueryDisplay } from './sql-query-display';
import { SqlResultDisplay } from './sql-result-display';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { ChartConfig } from '../ui/chart';
import type { DateRange } from '@/lib/charts.utils';
import type { DataExportFormat } from '@/components/export-data-menu';
import { trpc } from '@/main';
import {
	DATE_RANGE_OPTIONS,
	filterByDateRange,
	resolvePieTooltipLabel,
	sortByDateKey,
	toKey,
} from '@/lib/charts.utils';
import { useDateFormat } from '@/hooks/use-date-format';
import { useChatId } from '@/hooks/use-chat-id';
import { useResizeObserver } from '@/hooks/use-resize-observer';
import { useStoryIds } from '@/hooks/use-story-ids';
import { useSidePanel } from '@/contexts/side-panel';
import { useToolCallContext } from '@/contexts/tool-call';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { cn } from '@/lib/utils';
import { ExportDataMenu } from '@/components/export-data-menu';
import { useSourceQuery } from '@/hooks/use-source-query';

const Colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const LEGEND_SCROLL_OFFSET = 120;
const PIE_LEGEND_BREAKPOINT = 280;
const HORIZONTAL_LABEL_GAP = 12;
const DIAGONAL_LABEL_GAP = 8;
const CHAR_WIDTH_RATIO = 0.6;
const ANGLE_COS = Math.cos((35 * Math.PI) / 180);
const ANGLE_SIN = Math.sin((35 * Math.PI) / 180);
const MIN_TICK_FONT = 9;
const MAX_TICK_FONT = 12;
const MAX_TICK_LABEL_HEIGHT = 44;

type ViewMode = 'chart' | 'data' | 'query';

export const DisplayChartToolCall = ({ toolPart }: ToolCallComponentProps<'display_chart'>) => {
	const { state, input, output, toolCallId } = toolPart;
	const agent = useOptionalAgentContext();
	const chatId = useChatId();
	const queryClient = useQueryClient();
	const { open: openSidePanel, currentStorySlug, currentStoryTabIndex, isVisible } = useSidePanel();
	const { isSettled } = useToolCallContext();
	const config = state !== 'input-streaming' ? input : undefined;
	const chartConfig = config && displayChart.isChartInput(config) ? config : undefined;
	const tableConfig = config && displayChart.isTableInput(config) ? config : undefined;
	const isTableVariant = input?.chart_type === 'table';
	const isBuiltinChart = chartConfig ? displayChart.isBuiltinChartType(chartConfig.chart_type) : false;
	const [dataRange, setDataRange] = useState<DateRange>('all');
	const [viewMode, setViewMode] = useState<ViewMode>('chart');
	const storyIds = useStoryIds();
	const normalSize = useMemo(() => (document.querySelector('[data-selection-container]') ? true : false), []);
	const { mutate: logDownload } = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	const { mutate: addToStory } = useMutation(
		trpc.story.createVersion.mutationOptions({
			onSuccess: (_data, variables) => {
				queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({
					queryKey: trpc.story.getLatest.queryKey({
						chatId: variables.chatId,
						storySlug: variables.storySlug,
					}),
				});
			},
		}),
	);

	const [isDownloading, setIsDownloading] = useState(false);
	const [isEditOpen, setIsEditOpen] = useState(false);
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning && isBuiltinChart);

	const { sourceQuery, sourceData } = useSourceQuery(chartConfig?.query_id);
	const sqlQuery = sourceQuery?.input?.sql_query;

	const handleDownloadPng = async () => {
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

	const handleExportData = (format: DataExportFormat) => {
		if (chatId) {
			logDownload({ chatId, format, queryId: chartConfig?.query_id, title: chartConfig?.title });
		}
	};

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
	const customChartConfig = useMemo(
		() =>
			chartConfig
				? {
						...chartConfig,
						x_axis_key: chartConfig.x_axis_key ?? '',
						x_axis_type: chartConfig.x_axis_type ?? null,
					}
				: undefined,
		[chartConfig],
	);

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

	if (!chartConfig || !customChartConfig) {
		// Only show the loader while the input is genuinely still streaming. An
		// orphaned partial tool call stuck in `input-streaming` after the message
		// settled would otherwise render an endless loader.
		if (state !== 'input-streaming' || isSettled) {
			return null;
		}
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
		const usingVisibleStory = Boolean(isVisible && currentStorySlug && storyIds.includes(currentStorySlug));
		const targetId = usingVisibleStory ? currentStorySlug! : latestStoryId;
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
		const { code: newCode, tabIndex: openTabIndex } = appendBlockToStoryCode(latest.code, chartBlock, {
			usingVisibleStory,
			activeTabIndex: currentStoryTabIndex,
		});

		addToStory({
			chatId,
			storySlug: targetId,
			title: data.title,
			code: newCode,
			action: 'update',
		});

		if (!usingVisibleStory) {
			openSidePanel(
				<StoryViewer chatId={chatId} storySlug={targetId} initialTabIndex={openTabIndex} />,
				targetId,
			);
		}
	};

	const isKpiChartView = viewMode === 'chart' && chartConfig.chart_type === 'kpi_card';

	return (
		<div
			className={cn(
				'group/chart relative flex flex-col items-stretch my-4 -mx-3',
				'border transition-colors duration-150 rounded-lg overflow-hidden bg-backgroundSecondary/30',
				viewMode === 'chart' ? 'border-transparent hover:border-border' : 'border-border',
				viewMode === 'chart' ? 'gap-2 px-3' : 'gap-0',
				isKpiChartView ? 'py-3' : '',
				viewMode === 'chart' && chartConfig.chart_type !== 'kpi_card' && !normalSize ? 'aspect-3/2' : '',
			)}
		>
			<div
				className={cn(
					'flex items-center py-2',
					isKpiChartView ? 'absolute top-0 right-0 z-10 gap-1 px-3' : 'w-full justify-between',
					!isKpiChartView && (viewMode === 'chart' ? 'gap-2' : 'gap-0 px-3 border-b border-border'),
				)}
			>
				{chartConfig.chart_type != 'kpi_card' ? (
					<div className='flex items-center gap-1'>
						<span className='text-sm font-medium text-foreground flex-1'>{chartConfig.title}</span>
						{viewMode === 'chart' &&
							!displayChart.isPieChart(chartConfig.chart_type) &&
							chartConfig.x_axis_type === 'date' && (
								<ChartRangeSelector
									options={DATE_RANGE_OPTIONS}
									selectedRange={dataRange}
									onRangeSelected={(range) => setDataRange(range)}
								/>
							)}
					</div>
				) : (
					<div></div>
				)}
				<div className='flex items-center gap-1 shrink-0'>
					<div className='flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/chart:opacity-100 focus-within:opacity-100'>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className={cn(
								'rounded-full hover:bg-accent/70',
								viewMode === 'chart' ? 'bg-accent/70' : '',
							)}
							onClick={() => setViewMode('chart')}
							title='View chart'
						>
							<ChartNoAxesColumn className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
						</Button>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className={cn('rounded-full hover:bg-accent/70', viewMode === 'data' ? 'bg-accent/70' : '')}
							onClick={() => setViewMode('data')}
							title='View data'
						>
							<TableIcon className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
						</Button>
						{sqlQuery && (
							<Button
								variant='ghost-muted'
								size='icon-xs'
								className={cn(
									'rounded-full hover:bg-accent/70',
									viewMode === 'query' ? 'bg-accent/70' : '',
								)}
								onClick={() => setViewMode('query')}
								title='View SQL query'
							>
								<Code className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
							</Button>
						)}
						{storyIds.length > 0 && isBuiltinChart && (
							<Button
								variant='ghost-muted'
								size='icon-xs'
								className='rounded-full hover:bg-accent/70'
								onClick={handleAddToStory}
								title='Add to story'
							>
								<FilePlus className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
							</Button>
						)}

						{viewMode === 'chart' ? (
							isBuiltinChart &&
							chartConfig.chart_type != 'kpi_card' && (
								<Button
									variant='ghost-muted'
									size='icon-xs'
									className='rounded-full hover:bg-accent/70'
									onClick={handleDownloadPng}
									disabled={isDownloading}
									title='Download as PNG'
								>
									<Download className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
								</Button>
							)
						) : (
							<ExportDataMenu
								columns={sourceData.columns}
								data={sourceData.data as Record<string, unknown>[]}
								filename={chartConfig.title || 'chart'}
								onExport={handleExportData}
							>
								<Button
									variant='ghost-muted'
									size='icon-xs'
									className='rounded-full hover:bg-accent/70'
									title='Export data'
								>
									<Download className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
								</Button>
							</ExportDataMenu>
						)}
					</div>
					{isEditable && (
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className='rounded-full hover:bg-accent/70'
							onClick={() => setIsEditOpen(true)}
							title='Edit chart'
						>
							<Pencil className='size-3 text-muted-foreground/70' strokeWidth={2.25} />
						</Button>
					)}
				</div>
			</div>

			{isEditable && displayChart.isBuiltinChartType(chartConfig.chart_type) && (
				<DisplayChartEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					toolCallId={toolCallId}
					config={{ ...chartConfig, chart_type: chartConfig.chart_type }}
					availableColumns={sourceData.columns ?? []}
					data={sourceData.data ?? []}
				/>
			)}

			{viewMode === 'data' ? (
				<SqlResultDisplay output={sourceData} />
			) : viewMode === 'query' && sqlQuery ? (
				<SqlQueryDisplay query={sqlQuery} />
			) : !displayChart.isBuiltinChartType(chartConfig.chart_type) ? (
				<CustomChart config={customChartConfig} data={filteredData} />
			) : (
				<ChartDisplay
					data={filteredData}
					chartType={chartConfig.chart_type}
					xAxisKey={chartConfig.x_axis_key ?? ''}
					series={chartConfig.series}
					xAxisType={chartConfig.x_axis_type === 'number' ? 'number' : 'category'}
					xAxisLabel={chartConfig.x_axis_label}
					title={chartConfig.title}
					yAxisMin={chartConfig.y_axis_min}
					yAxisMax={chartConfig.y_axis_max}
					yAxisLabel={chartConfig.y_axis_label}
					yAxisRightMin={chartConfig.y_axis_right_min}
					yAxisRightMax={chartConfig.y_axis_right_max}
					yAxisRightLabel={chartConfig.y_axis_right_label}
					showDataLabels={chartConfig.show_data_labels}
					comparisonMode={'comparison_mode' in chartConfig ? chartConfig.comparison_mode : undefined}
					hideTotal={chartConfig.hide_total}
				/>
			)}
		</div>
	);
};

export interface ChartDisplayProps {
	data: Record<string, unknown>[];
	chartType: displayChart.ChartType;
	xAxisKey: string;
	xAxisType: 'number' | 'category';
	xAxisLabel?: string;
	xAxisLabelFormatter?: (value: string) => string;
	valueFormatter?: (value: number) => string;
	series: displayChart.SeriesConfig[];
	title?: string;
	titleStyle?: 'default' | 'left';
	titleAccessory?: React.ReactNode;
	showLegend?: boolean;
	showGrid?: boolean;
	yAxisMin?: number;
	yAxisMax?: number;
	yAxisLabel?: string;
	yAxisRightMin?: number;
	yAxisRightMax?: number;
	yAxisRightLabel?: string;
	showDataLabels?: boolean;
	animate?: boolean;
	comparisonMode?: displayChart.ComparisonMode;
	className?: string;
	chartContainerClassName?: string;
	chartContentClassName?: string;
	normalSize?: boolean;
	hideTotal?: boolean;
	kpiLeadingSlot?: React.ReactNode;
	disableTooltip?: boolean;
}

export const ChartDisplay = memo(function ChartDisplay({
	data,
	chartType,
	xAxisKey: xAxisKeyProp,
	xAxisType,
	xAxisLabel,
	xAxisLabelFormatter,
	valueFormatter,
	series: seriesProp,
	title,
	titleStyle = 'default',
	titleAccessory,
	showLegend = true,
	showGrid = true,
	yAxisMin,
	yAxisMax,
	yAxisLabel,
	yAxisRightMin,
	yAxisRightMax,
	yAxisRightLabel,
	showDataLabels,
	animate = false,
	comparisonMode,
	className,
	chartContainerClassName,
	chartContentClassName,
	normalSize = false,
	hideTotal,
	kpiLeadingSlot,
	disableTooltip = false,
}: ChartDisplayProps) {
	const dateFormat = useDateFormat();
	const containerRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [plotWidth, setPlotWidth] = useState(0);
	useResizeObserver(containerRef, (element) => {
		setWidth(element.getBoundingClientRect().width);
	});
	const gradientIdPrefix = `${useId().replace(/[^a-zA-Z0-9]/g, '')}-`;
	const handlePlotWidthChange = useCallback((nextPlotWidth: number) => {
		setPlotWidth((currentPlotWidth) => (currentPlotWidth === nextPlotWidth ? currentPlotWidth : nextPlotWidth));
	}, []);

	const xAxisKey = useMemo(() => resolveDataKey(data, xAxisKeyProp), [data, xAxisKeyProp]);
	const series = useMemo(
		() => seriesProp.map((s) => ({ ...s, data_key: resolveDataKey(data, s.data_key) })),
		[data, seriesProp],
	);

	const { visibleSeries, hiddenSeriesKeys, handleToggleSeriesVisibility } = useSeriesVisibility(series);
	const isPercentStacked = displayChart.isPercentStackedChartType(chartType);

	const isPie = displayChart.isPieChart(chartType);
	const compactPieLegend = isPie && width > 0 && width < PIE_LEGEND_BREAKPOINT;
	const pieCenteringClass = isPie && !compactPieLegend ? 'mx-auto max-w-[480px]' : '';
	const pieValueKey = series[0]?.data_key ?? '';
	const pieData = useMemo(
		() => (isPie ? bucketPieData(data, xAxisKey, pieValueKey) : data),
		[isPie, data, xAxisKey, pieValueKey],
	);
	const useInlineHeader = titleStyle === 'left' && Boolean(title) && !isPie;
	const showInlineLegend = showLegend && chartType !== 'kpi_card';
	const { scrollRef, canScrollLeft, canScrollRight, scrollLegend } = useHorizontalScrollControls();

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
					[pieValueKey]: {
						valueFormat: series[0]?.value_format,
					},
				},
			);
		}

		return series.reduce((acc, s, idx) => {
			acc[s.data_key] = {
				label: s.label || labelize(s.data_key, dateFormat),
				color: s.color || Colors[idx % Colors.length],
				isTotal: s.is_total,
				valueFormat: s.value_format,
			};
			return acc;
		}, {} as ChartConfig);
	}, [series, xAxisKey, pieValueKey, pieData, isPie, dateFormat]);

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
	const xAxisWidth = plotWidth > 0 ? plotWidth : width;
	const perCategoryPx = xAxisWidth > 0 ? xAxisWidth / Math.max(data.length, 1) : 0;
	const longestLabelLen = Math.max(1, ...data.map((row) => labelFormatter(String(row[xAxisKey])).length));
	// Keep labels horizontal while they fit side by side (label width plus a small gap);
	// only once they would actually collide do we shrink + rotate, and then discard.
	const horizontalLabelPx = longestLabelLen * MAX_TICK_FONT * CHAR_WIDTH_RATIO + HORIZONTAL_LABEL_GAP;
	const compactXAxis = !isPie && xAxisType === 'category' && xAxisWidth > 0 && perCategoryPx < horizontalLabelPx;

	let xAxisTickFontSize: number | undefined;
	let xAxisMaxLabelChars: number | undefined;
	let compactXAxisInterval: number | undefined;
	if (compactXAxis) {
		const neededFont = perCategoryPx / (longestLabelLen * CHAR_WIDTH_RATIO * ANGLE_COS);
		xAxisTickFontSize = Math.round(Math.max(MIN_TICK_FONT, Math.min(MAX_TICK_FONT, neededFont)));

		const charPx = xAxisTickFontSize * CHAR_WIDTH_RATIO;
		// A rotated label can't be taller than the axis band, so cap its length first, then
		// reserve slots from the length we actually draw (not the full label) — otherwise we
		// discard more labels than the space truly needs.
		const verticalCharCap = Math.floor(MAX_TICK_LABEL_HEIGHT / (charPx * ANGLE_SIN));
		if (longestLabelLen > verticalCharCap) {
			xAxisMaxLabelChars = verticalCharCap;
		}
		const drawnLabelLen = Math.min(longestLabelLen, verticalCharCap);
		const labelSlotPx = drawnLabelLen * charPx * ANGLE_COS + DIAGONAL_LABEL_GAP;
		if (perCategoryPx < labelSlotPx) {
			// N labels need only N-1 gaps between them, so credit one gap back before dividing;
			// otherwise a label is discarded a full slot early, before the labels actually touch.
			const maxVisible = Math.max(1, Math.floor((xAxisWidth + DIAGONAL_LABEL_GAP) / labelSlotPx));
			compactXAxisInterval = Math.max(0, Math.ceil(data.length / maxVisible) - 1);
		}
	}

	const tooltipLabelFormatter = useMemo(
		() => (value: unknown, items: unknown) =>
			isPie
				? labelize(resolvePieTooltipLabel(items as { name?: unknown }[]), dateFormat)
				: labelize(value as string, dateFormat),
		[isPie, dateFormat],
	);

	const isDualAxis = displayChart.isComboChart(chartType) && displayChart.hasRightAxisSeries(visibleSeries);

	const chartElement = useMemo(
		() =>
			buildChart({
				data: pieData,
				chartType,
				xAxisKey,
				xAxisType,
				xAxisLabel,
				series: visibleSeries,
				colorFor,
				labelFormatter,
				valueFormatter,
				compactXAxis,
				compactXAxisInterval,
				xAxisTickFontSize,
				xAxisMaxLabelChars,
				showGrid,
				showDataLabels,
				animate,
				comparisonMode,
				gradientIdPrefix,
				kpiLeadingSlot,
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				yAxisMin,
				yAxisMax,
				yAxisLabel,
				yAxisRightMin,
				yAxisRightMax,
				yAxisRightLabel,
				children: [
					<ChartTooltip
						key='tooltip'
						active={disableTooltip ? false : undefined}
						animationDuration={150}
						animationEasing='linear'
						allowEscapeViewBox={{ y: false, x: false }}
						content={
							<ChartTooltipContent
								percent={isPercentStacked}
								isDualAxis={isDualAxis}
								hideTotal={hideTotal}
								labelFormatter={tooltipLabelFormatter}
								nameKey={isPie ? pieValueKey : undefined}
								valueFormatter={valueFormatter}
							/>
						}
					/>,
					chartType !== 'kpi_card' && (
						<Customized
							key='plot-width-observer'
							component={<ChartPlotWidthObserver onWidthChange={handlePlotWidthChange} />}
						/>
					),
					showLegend && chartType !== 'kpi_card' && !useInlineHeader && (
						<ChartLegend
							key='legend'
							payload={legendPayload}
							layout={isPie && !compactPieLegend ? 'vertical' : 'horizontal'}
							align={isPie && !compactPieLegend ? 'right' : 'center'}
							verticalAlign={isPie && !compactPieLegend ? 'middle' : 'bottom'}
							content={
								<ChartLegendContent
									layout={isPie && !compactPieLegend ? 'vertical' : 'horizontal'}
									className={compactPieLegend ? 'flex-wrap' : undefined}
									onItemClick={isPie ? undefined : handleToggleSeriesVisibility}
								/>
							}
						/>
					),
				].filter(Boolean),
				title: useInlineHeader ? undefined : title,
				renderTitle: false,
			}),
		[
			pieData,
			chartType,
			isPie,
			compactPieLegend,
			compactXAxis,
			compactXAxisInterval,
			xAxisTickFontSize,
			xAxisMaxLabelChars,
			xAxisKey,
			pieValueKey,
			xAxisType,
			xAxisLabel,
			visibleSeries,
			colorFor,
			labelFormatter,
			tooltipLabelFormatter,
			valueFormatter,
			showGrid,
			yAxisMin,
			yAxisMax,
			yAxisLabel,
			yAxisRightMin,
			yAxisRightMax,
			yAxisRightLabel,
			isDualAxis,
			showDataLabels,
			animate,
			comparisonMode,
			gradientIdPrefix,
			kpiLeadingSlot,
			hideTotal,
			handlePlotWidthChange,
			legendPayload,
			handleToggleSeriesVisibility,
			title,
			isPercentStacked,
			showLegend,
			useInlineHeader,
			disableTooltip,
		],
	);

	const inlineHeader = useInlineHeader ? (
		<div className='mb-6 flex w-full min-w-0 items-center gap-3'>
			<div className={showInlineLegend ? 'min-h-11 shrink-0' : 'shrink-0'}>
				<span className='block text-[15px] font-semibold'>{title}</span>
				{titleAccessory}
			</div>
			{showInlineLegend && canScrollLeft && (
				<Button
					variant='ghost-muted'
					size='icon-xs'
					onClick={() => scrollLegend('left')}
					aria-label='Scroll legend left'
					className='shrink-0'
				>
					<ChevronLeft className='size-3.5' />
				</Button>
			)}
			{showInlineLegend && (
				<div
					ref={scrollRef}
					className='min-w-0 flex-1 overflow-x-auto pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
				>
					<ChartLegendContent
						payload={legendPayload}
						align='right'
						onItemClick={handleToggleSeriesVisibility}
						className='w-max min-w-full gap-3 p-0 text-[10px] [&>*]:shrink-0'
					/>
				</div>
			)}
			{showInlineLegend && canScrollRight && (
				<Button
					variant='ghost-muted'
					size='icon-xs'
					onClick={() => scrollLegend('right')}
					aria-label='Scroll legend right'
					className='shrink-0'
				>
					<ChevronRight className='size-3.5' />
				</Button>
			)}
		</div>
	) : undefined;

	return (
		<div
			ref={containerRef}
			className={cn(
				'flex flex-col items-stretch gap-2 w-full',
				chartType !== 'kpi_card' && normalSize ? 'h-full' : '',
				className,
			)}
		>
			{chartType === 'kpi_card' ? (
				<>
					{inlineHeader}
					{chartElement}
				</>
			) : (
				<ChartContainer
					config={chartConfig}
					className={cn(normalSize ? 'h-full w-full' : 'w-full', pieCenteringClass, chartContainerClassName)}
					contentClassName={cn(normalSize ? 'aspect-auto flex-1 min-h-0' : undefined, chartContentClassName)}
					header={inlineHeader}
				>
					{chartElement}
				</ChartContainer>
			)}
		</div>
	);
});

interface ChartPlotWidthObserverProps {
	offset?: { width?: number };
	onWidthChange: (width: number) => void;
}

function ChartPlotWidthObserver({ offset, onWidthChange }: ChartPlotWidthObserverProps) {
	const offsetWidth = offset?.width;

	useEffect(() => {
		if (typeof offsetWidth === 'number' && Number.isFinite(offsetWidth) && offsetWidth > 0) {
			onWidthChange(offsetWidth);
		}
	}, [offsetWidth, onWidthChange]);

	return null;
}

const useHorizontalScrollControls = () => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [scrollState, setScrollState] = useState({
		canScrollLeft: false,
		canScrollRight: false,
	});

	const updateScrollState = useCallback(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}

		const maxScrollLeft = element.scrollWidth - element.clientWidth;
		setScrollState({
			canScrollLeft: element.scrollLeft > 1,
			canScrollRight: element.scrollLeft < maxScrollLeft - 1,
		});
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) {
			return;
		}

		updateScrollState();
		element.addEventListener('scroll', updateScrollState, { passive: true });

		if (typeof ResizeObserver === 'undefined') {
			return () => element.removeEventListener('scroll', updateScrollState);
		}

		const resizeObserver = new ResizeObserver(updateScrollState);
		resizeObserver.observe(element);

		if (element.firstElementChild) {
			resizeObserver.observe(element.firstElementChild);
		}

		return () => {
			element.removeEventListener('scroll', updateScrollState);
			resizeObserver.disconnect();
		};
	}, [updateScrollState]);

	const scrollLegend = useCallback((direction: 'left' | 'right') => {
		scrollRef.current?.scrollBy({
			left: direction === 'left' ? -LEGEND_SCROLL_OFFSET : LEGEND_SCROLL_OFFSET,
			behavior: 'smooth',
		});
	}, []);

	return {
		...scrollState,
		scrollRef,
		scrollLegend,
	};
};

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
