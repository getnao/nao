import { memo, useMemo } from 'react';
import type { displayChart } from '@nao/shared/tools';
import { useAgentContext } from '@/contexts/agent.provider';
import { ChartDisplay } from '@/components/tool-calls/display-chart';

interface ChartBlock {
	queryId: string;
	chartType: string;
	xAxisKey: string;
	xAxisType: string | null;
	series: Array<{ data_key: string; color: string; label?: string }>;
	title: string;
}

export const StoryChartEmbed = memo(function StoryChartEmbed({ chart }: { chart: ChartBlock }) {
	const { messages } = useAgentContext();

	const sourceData = useMemo(() => {
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output?.id === chart.queryId) {
					return part.output;
				}
			}
		}
		return null;
	}, [messages, chart.queryId]);

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
		<div className='my-2 aspect-3/2'>
			<ChartDisplay
				data={sourceData.data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={xAxisType}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
});
