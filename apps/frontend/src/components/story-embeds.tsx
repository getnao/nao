import { Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { displayChart } from '@nao/shared/tools';

import type { ParsedChartBlock, ParsedTableBlock } from '@/lib/story-segments';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { TableDisplay } from '@/components/tool-calls/display-table';

export type QueryDataMap = Record<string, { data: Record<string, unknown>[]; columns: string[] }>;

interface LiveQueryConfig {
	queryOptions: (input: { chatId: string; queryId: string }) => object;
	chatId: string;
}

function EmbedPlaceholder({ children }: { children: React.ReactNode }) {
	return (
		<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
			{children}
		</div>
	);
}

function EmbedLoading() {
	return (
		<EmbedPlaceholder>
			<span className='flex items-center justify-center'>
				<Loader2 className='size-4 animate-spin mr-2' />
				Loading live data...
			</span>
		</EmbedPlaceholder>
	);
}

function useLiveQueryData(queryId: string, liveQuery?: LiveQueryConfig) {
	return useQuery({
		queryKey: ['noop', queryId],
		queryFn: () => null,
		enabled: false,
		...(liveQuery ? liveQuery.queryOptions({ chatId: liveQuery.chatId, queryId }) : {}),
		...(liveQuery ? { staleTime: 0, enabled: true } : {}),
	});
}

export const StoryChartEmbed = memo(function StoryChartEmbed({
	chart,
	queryData,
	liveQuery,
}: {
	chart: ParsedChartBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
}) {
	const noCacheFetch = useLiveQueryData(chart.queryId, liveQuery);

	const resolvedData = liveQuery
		? (noCacheFetch.data as { data: Record<string, unknown>[]; columns: string[] } | undefined)?.data
		: queryData?.[chart.queryId]?.data;

	if (liveQuery && noCacheFetch.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolvedData || resolvedData.length === 0) {
		return <EmbedPlaceholder>Chart data unavailable</EmbedPlaceholder>;
	}

	if (chart.series.length === 0) {
		return <EmbedPlaceholder>No series configured for chart</EmbedPlaceholder>;
	}

	return (
		<div className={`my-2 ${chart.chartType !== 'kpi_card' ? 'aspect-3/2' : ''}`}>
			<ChartDisplay
				data={resolvedData}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
});

export const StoryTableEmbed = memo(function StoryTableEmbed({
	table,
	queryData,
	liveQuery,
}: {
	table: ParsedTableBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
}) {
	const noCacheFetch = useLiveQueryData(table.queryId, liveQuery);

	const resolvedResult = liveQuery
		? (noCacheFetch.data as { data: Record<string, unknown>[]; columns: string[] } | undefined)
		: queryData?.[table.queryId];

	if (liveQuery && noCacheFetch.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolvedResult?.data) {
		return <EmbedPlaceholder>Table data unavailable</EmbedPlaceholder>;
	}

	return (
		<TableDisplay
			data={resolvedResult.data}
			columns={resolvedResult.columns}
			title={table.title}
			tableContainerClassName='max-h-[28rem]'
		/>
	);
});
