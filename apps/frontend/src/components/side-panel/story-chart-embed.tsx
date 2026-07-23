import { Code, Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { displayChart } from '@nao/shared/tools';

import { StoryChartQueryView } from '@/components/side-panel/story-chart-query';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { ChartConfigEditDialog } from '@/components/tool-calls/display-chart-edit-dialog';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryChartEdit } from '@/contexts/story-chart-edit';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryQuerySql } from '@/contexts/story-query-sql';
import { sortByDateKey } from '@/lib/charts.utils';
import { findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';
import { cn } from '@/lib/utils';

interface ChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string; is_total?: boolean }>;
	yAxisMin?: number;
	yAxisMax?: number;
	title: string;
	showDataLabels?: boolean;
	rawTag?: string;
}

export const StoryChartEmbed = memo(function StoryChartEmbed({ chart }: { chart: ChartBlock }) {
	const agent = useOptionalAgentContext();
	const embedData = useStoryEmbedData();

	const sourceData = useMemo(() => {
		const fromEmbedData = embedData?.[chart.queryId];
		if (fromEmbedData) {
			return fromEmbedData;
		}

		return findLatestExecuteSqlInMessages(agent?.messages ?? [], chart.queryId)?.output ?? null;
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
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable (query: {chart.queryId})
			</div>
		);
	}

	if (chart.series.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				No series configured for chart
			</div>
		);
	}

	const xAxisType = chart.xAxisType === 'number' ? 'number' : ('category' as const);

	return (
		<StoryChartEmbedShell chart={chart} availableColumns={sourceData.columns ?? []}>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={xAxisType}
				series={chart.series}
				title={chart.title}
				yAxisMin={chart.yAxisMin}
				yAxisMax={chart.yAxisMax}
				showDataLabels={chart.showDataLabels}
			/>
		</StoryChartEmbedShell>
	);
});

interface StoryChartEmbedShellProps {
	chart: ChartBlock;
	availableColumns: string[];
	children: React.ReactNode;
}

/**
 * Wraps a rendered chart with an "Edit chart" button when the surrounding story
 * context provides a save handler.
 */
export function StoryChartEmbedShell({ chart, availableColumns, children }: StoryChartEmbedShellProps) {
	const edit = useStoryChartEdit();
	const querySqlSource = useStoryQuerySql();
	const [isEditOpen, setIsEditOpen] = useState(false);
	const [showQuery, setShowQuery] = useState(false);
	const canEdit = Boolean(edit && chart.rawTag);
	const canViewQuery = Boolean(querySqlSource);
	const showHeader = canEdit || canViewQuery || (chart.chartType != 'kpi_card' && chart.title);

	const config = useMemo<displayChart.ChartInput>(
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
			})),
			y_axis_min: chart.yAxisMin,
			y_axis_max: chart.yAxisMax,
			title: chart.title,
			show_data_labels: chart.showDataLabels,
		}),
		[chart],
	);

	return (
		<div className='my-2 flex flex-col gap-4'>
			{showHeader && (
				<div className='flex w-full items-center justify-between gap-2'>
					{chart.chartType != 'kpi_card' && chart.title ? (
						<span className='text-sm font-medium text-foreground flex-1 min-w-0 truncate'>
							{chart.title}
						</span>
					) : (
						<div className='flex-1' />
					)}
					<div className='flex shrink-0 items-center gap-1'>
						{canViewQuery && (
							<Button
								variant='ghost-muted'
								size='icon-xs'
								onClick={() => setShowQuery((current) => !current)}
								title={showQuery ? 'Hide SQL query' : 'View SQL query'}
								className={cn(
									'shrink-0 hover:bg-accent hover:rounded-full',
									showQuery && 'bg-accent rounded-full',
								)}
							>
								<Code className='size-3.5' />
							</Button>
						)}
						{canEdit && (
							<Button
								variant='ghost-muted'
								size='icon-xs'
								onClick={() => setIsEditOpen(true)}
								title='Edit chart'
								className='shrink-0 hover:bg-accent hover:rounded-full'
							>
								<Pencil className='size-3.5' />
							</Button>
						)}
					</div>
				</div>
			)}
			{showQuery && querySqlSource ? (
				<StoryChartQueryView queryId={chart.queryId} source={querySqlSource} />
			) : (
				<div className={`relative ${chart.chartType != 'kpi_card' ? 'aspect-3/2' : ''}`}>{children}</div>
			)}
			{canEdit && edit && chart.rawTag && (
				<ChartConfigEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					config={config}
					availableColumns={availableColumns}
					isSaving={edit.isSaving}
					onSave={(next) => edit.saveChart(chart.rawTag!, next)}
					description={edit.saveDescription}
				/>
			)}
		</div>
	);
}
