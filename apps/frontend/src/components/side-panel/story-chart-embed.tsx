import { Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { UIMessage } from '@nao/backend/chat';
import type { ParsedChartBlock } from '@nao/shared/story-segments';
import type { displayChart } from '@nao/shared/tools';

import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { ChartConfigEditDialog } from '@/components/tool-calls/display-chart-edit-dialog';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryChartEdit } from '@/contexts/story-chart-edit';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { sortByDateKey } from '@/lib/charts.utils';

const STORY_CHART_HEIGHT_CLASS = 'h-72';

type ChartBlock = ParsedChartBlock;

export const StoryChartEmbed = memo(function StoryChartEmbed({
	chart,
	dragHandle,
}: {
	chart: ChartBlock;
	dragHandle?: React.ReactNode;
}) {
	const agent = useOptionalAgentContext();
	const embedData = useStoryEmbedData();

	const sourceData = useMemo(() => {
		const fromEmbedData = embedData?.[chart.queryId];
		if (fromEmbedData) {
			return fromEmbedData;
		}

		const findInMessages = (messages: UIMessage[]) => {
			for (const message of messages) {
				for (const part of message.parts) {
					if (part.type === 'tool-execute_sql' && part.output?.id === chart.queryId) {
						return part.output;
					}
				}
			}
			return null;
		};

		return findInMessages(agent?.messages ?? []);
	}, [embedData, agent?.messages, chart.queryId]);

	const data = useMemo(
		() =>
			sourceData?.data && chart.xAxisType === 'date'
				? sortByDateKey(sourceData.data, chart.xAxisKey)
				: (sourceData?.data ?? []),
		[sourceData?.data, chart.xAxisType, chart.xAxisKey],
	);

	if (!sourceData?.data || sourceData.data.length === 0) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle}>
				Chart data unavailable (query: {chart.queryId})
			</StoryEmbedFallback>
		);
	}

	if (chart.series.length === 0) {
		return <StoryEmbedFallback dragHandle={dragHandle}>No series configured for chart</StoryEmbedFallback>;
	}

	const xAxisType = chart.xAxisType === 'number' ? 'number' : ('category' as const);

	return (
		<StoryChartEmbedShell
			chart={chart}
			availableColumns={sourceData.columns ?? []}
			data={sourceData.data ?? []}
			dragHandle={dragHandle}
		>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={xAxisType}
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
			/>
		</StoryChartEmbedShell>
	);
});

interface StoryChartEmbedShellProps {
	chart: ChartBlock;
	availableColumns: string[];
	data?: Record<string, unknown>[];
	dragHandle?: React.ReactNode;
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
	children,
}: StoryChartEmbedShellProps) {
	const edit = useStoryChartEdit();
	const [isEditOpen, setIsEditOpen] = useState(false);
	const canEdit = Boolean(edit && chart.rawTag);

	const config = useMemo<displayChart.KpiCardInput>(
		() => ({
			query_id: chart.queryId,
			chart_type: chart.chartType as displayChart.ChartType,
			x_axis_key: chart.xAxisKey,
			x_axis_type: (chart.xAxisType || null) as displayChart.XAxisType | null,
			series: chart.series.map((s) => ({
				data_key: s.data_key,
				color: s.color || undefined,
				label: s.label,
				is_total: s.is_total,
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

	return (
		<div className='my-2 flex flex-col gap-4'>
			{!isKpi && (canEdit || dragHandle != null || chart.title) && (
				<div className='flex w-full items-center justify-between gap-2'>
					{chart.title ? (
						<span className='text-sm font-medium text-foreground flex-1 min-w-0 truncate'>
							{chart.title}
						</span>
					) : (
						<div className='flex-1' />
					)}
					<div className='flex shrink-0 items-center gap-1'>
						{dragHandle}
						{editButton}
					</div>
				</div>
			)}
			<div className={`relative ${!isKpi ? STORY_CHART_HEIGHT_CLASS : ''}`}>
				{children}
				{isKpi && (dragHandle != null || editButton) && (
					<div className='absolute top-0 right-0 flex items-center gap-1'>
						{dragHandle}
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
