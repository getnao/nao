import { Code, Pencil } from 'lucide-react';
import { memo, useContext, useMemo, useState } from 'react';
import { StoryBlockDragContext } from './story-editor-drag-context';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { ParsedChartBlock } from '@nao/shared/story-segments';
import type { displayChart } from '@nao/shared/tools';

import { StoryChartQueryView } from '@/components/side-panel/story-chart-query';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { ChartConfigEditDialog } from '@/components/tool-calls/display-chart-edit-dialog';
import { Button } from '@/components/ui/button';
import { useStoryChartEdit } from '@/contexts/story-chart-edit';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryQuerySql } from '@/contexts/story-query-sql';
import { useSourceQuery } from '@/hooks/use-source-query';
import { sortByDateKey } from '@/lib/charts.utils';
import { cn } from '@/lib/utils';

const STORY_CHART_HEIGHT_CLASS = 'h-72';

type ChartBlock = ParsedChartBlock;

export const StoryChartEmbed = memo(function StoryChartEmbed({
	chart,
	dragHandle,
	dragHandlePlacement = 'trailing',
	isSelected,
}: {
	chart: ChartBlock;
	dragHandle?: React.ReactNode;
	dragHandlePlacement?: 'leading' | 'trailing';
	isSelected?: boolean;
}) {
	const embedData = useStoryEmbedData();
	const storyBlockDrag = useContext(StoryBlockDragContext);
	const embedSourceData = embedData?.[chart.queryId];
	const { sourceData: agentSourceData } = useSourceQuery(embedSourceData ? undefined : chart.queryId);
	const sourceData = embedSourceData ?? agentSourceData;

	const data = useMemo(
		() =>
			sourceData?.data && chart.xAxisType === 'date'
				? sortByDateKey(sourceData.data, chart.xAxisKey)
				: (sourceData?.data ?? []),
		[sourceData?.data, chart.xAxisType, chart.xAxisKey],
	);

	if (!sourceData?.data || sourceData.data.length === 0) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle} dragHandlePlacement={dragHandlePlacement}>
				Chart data unavailable (query: {chart.queryId})
			</StoryEmbedFallback>
		);
	}

	if (chart.series.length === 0) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle} dragHandlePlacement={dragHandlePlacement}>
				No series configured for chart
			</StoryEmbedFallback>
		);
	}

	const xAxisType = chart.xAxisType === 'number' ? 'number' : ('category' as const);
	const isKpi = chart.chartType === 'kpi_card';
	const kpiLeadingHandle = isKpi && dragHandlePlacement === 'leading' ? dragHandle : undefined;

	return (
		<StoryChartEmbedShell
			chart={chart}
			availableColumns={sourceData.columns ?? []}
			data={sourceData.data ?? []}
			dragHandle={kpiLeadingHandle ? undefined : dragHandle}
			dragHandlePlacement={dragHandlePlacement}
		>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={xAxisType}
				xAxisLabel={chart.xAxisLabel}
				series={chart.series}
				title={chart.title}
				yAxisMin={chart.yAxisMin}
				yAxisMax={chart.yAxisMax}
				yAxisLabel={chart.yAxisLabel}
				yAxisRightMin={chart.yAxisRightMin}
				yAxisRightMax={chart.yAxisRightMax}
				yAxisRightLabel={chart.yAxisRightLabel}
				showDataLabels={chart.showDataLabels}
				comparisonMode={chart.comparisonMode}
				normalSize
				hideTotal={chart.hideTotal}
				kpiLeadingSlot={kpiLeadingHandle}
				disableTooltip={isSelected || storyBlockDrag?.isDragging === true}
				className={cn(isKpi && storyBlockDrag != null && 'select-none')}
			/>
		</StoryChartEmbedShell>
	);
});

interface StoryChartEmbedShellProps {
	chart: ChartBlock;
	availableColumns: string[];
	data?: Record<string, unknown>[];
	dragHandle?: React.ReactNode;
	dragHandlePlacement?: 'leading' | 'trailing';
	children: React.ReactNode;
}

/**
 * Wraps a rendered chart with an "Edit chart" button when the surrounding story
 * context provides a save handler.
 */
export function StoryChartEmbedShell({
	chart,
	availableColumns,
	data,
	dragHandle,
	dragHandlePlacement = 'trailing',
	children,
}: StoryChartEmbedShellProps) {
	const edit = useStoryChartEdit();
	const querySqlSource = useStoryQuerySql();
	const [isEditOpen, setIsEditOpen] = useState(false);
	const [showQuery, setShowQuery] = useState(false);
	const canEdit = Boolean(edit && chart.rawTag);
	const canViewQuery = Boolean(querySqlSource);

	const config = useMemo(
		() => ({
			query_id: chart.queryId,
			chart_type: chart.chartType as displayChart.ChartType,
			x_axis_key: chart.xAxisKey,
			x_axis_type: (chart.xAxisType || null) as displayChart.XAxisType | null,
			x_axis_label: chart.xAxisLabel,
			series: chart.series.map((s) => ({
				data_key: s.data_key,
				color: s.color || undefined,
				label: s.label,
				is_total: s.is_total,
				value_format: s.value_format,
				series_type: s.series_type,
				y_axis: s.y_axis,
			})),
			y_axis_min: chart.yAxisMin,
			y_axis_max: chart.yAxisMax,
			y_axis_label: chart.yAxisLabel,
			y_axis_right_min: chart.yAxisRightMin,
			y_axis_right_max: chart.yAxisRightMax,
			y_axis_right_label: chart.yAxisRightLabel,
			title: chart.title,
			show_data_labels: chart.showDataLabels,
			comparison_mode: chart.comparisonMode,
			hide_total: chart.hideTotal,
		}),
		[chart],
	);

	const isKpi = chart.chartType === 'kpi_card';
	const editButton = canEdit ? (
		<Button
			variant='ghost-muted'
			size='icon-xs'
			onClick={() => setIsEditOpen(true)}
			title='Edit chart'
			className='shrink-0 hover:bg-accent hover:rounded-full'
		>
			<Pencil className='size-3.5' />
		</Button>
	) : null;
	const queryButton = canViewQuery ? (
		<Button
			variant='ghost-muted'
			size='icon-xs'
			onClick={() => setShowQuery((current) => !current)}
			title={showQuery ? 'Hide SQL query' : 'View SQL query'}
			className={cn('shrink-0 hover:bg-accent hover:rounded-full', showQuery && 'bg-accent rounded-full')}
		>
			<Code className='size-3.5' />
		</Button>
	) : null;

	return (
		<div className='my-2 flex flex-col gap-4'>
			{!isKpi && (canEdit || canViewQuery || dragHandle != null || chart.title) && (
				<div className='flex w-full items-center justify-between gap-2'>
					<div className='flex min-w-0 flex-1 items-center gap-1'>
						{dragHandlePlacement === 'leading' ? dragHandle : null}
						{chart.title ? (
							<span className='text-sm font-medium text-foreground min-w-0 truncate'>{chart.title}</span>
						) : null}
					</div>
					<div className='flex shrink-0 items-center gap-1'>
						{dragHandlePlacement === 'leading' ? null : dragHandle}
						{queryButton}
						{editButton}
					</div>
				</div>
			)}
			<div className={cn('relative', !isKpi && !showQuery && STORY_CHART_HEIGHT_CLASS)}>
				{showQuery && querySqlSource ? (
					<StoryChartQueryView queryId={chart.queryId} source={querySqlSource} />
				) : (
					children
				)}
				{isKpi && ((dragHandlePlacement !== 'leading' && dragHandle != null) || canViewQuery || canEdit) && (
					<div className='absolute top-0 right-0 z-10 flex items-center gap-1'>
						{dragHandlePlacement === 'leading' ? null : dragHandle}
						{queryButton}
						{editButton}
					</div>
				)}
			</div>
			{canEdit && edit && chart.rawTag && (
				<ChartConfigEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					config={config}
					availableColumns={availableColumns}
					data={data}
					isSaving={edit.isSaving}
					onSave={(next) => edit.saveChart(chart.rawTag!, next)}
					description={edit.saveDescription}
				/>
			)}
		</div>
	);
}
