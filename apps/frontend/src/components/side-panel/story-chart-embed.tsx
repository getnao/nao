import { memo, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { UIMessage } from '@nao/backend/chat';
import type { displayChart } from '@nao/shared/tools';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryChartEdit } from '@/contexts/story-chart-edit';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { ChartConfigEditDialog } from '@/components/tool-calls/display-chart-edit-dialog';
import { sortByDateKey } from '@/lib/charts.utils';

interface ChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string }>;
	title: string;
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
	const [isEditOpen, setIsEditOpen] = useState(false);
	const canEdit = Boolean(edit && chart.rawTag);

	const config = useMemo<displayChart.Input>(
		() => ({
			query_id: chart.queryId,
			chart_type: chart.chartType as displayChart.ChartType,
			x_axis_key: chart.xAxisKey,
			x_axis_type: (chart.xAxisType || null) as displayChart.XAxisType | null,
			series: chart.series.map((s) => ({
				data_key: s.data_key,
				color: s.color || undefined,
				label: s.label,
			})),
			title: chart.title,
		}),
		[chart],
	);

	return (
		<div className={`my-2 relative ${chart.chartType != 'kpi_card' ? 'aspect-3/2' : ''}`}>
			{canEdit && (
				<Button
					variant='ghost-muted'
					size='icon-xs'
					onClick={() => setIsEditOpen(true)}
					title='Edit chart'
					className='absolute top-1 right-1 z-10 bg-background/80 backdrop-blur hover:bg-accent hover:rounded-full'
				>
					<Pencil className='size-3.5' />
				</Button>
			)}
			{children}
			{canEdit && edit && chart.rawTag && (
				<ChartConfigEditDialog
					open={isEditOpen}
					onOpenChange={setIsEditOpen}
					config={config}
					availableColumns={availableColumns}
					isSaving={edit.isSaving}
					onSave={(next) => edit.saveChart(chart.rawTag!, next)}
					description='Tweak the chart parameters. Changes are saved to the story as a new version.'
				/>
			)}
		</div>
	);
}
