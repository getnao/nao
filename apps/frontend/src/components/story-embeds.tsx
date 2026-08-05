import { Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import { StoryChartEmbedShell } from '@/components/side-panel/story-chart-embed';
import { StoryMapEmbedShell } from '@/components/side-panel/story-map-embed';
import { StoryTableEditControls } from '@/components/side-panel/story-table-embed';
import { StoryMapRender } from '@/components/story-map-embed';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { DataTableCard } from '@/components/data-table-card';
import { cn } from '@/lib/utils';

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

function EmbedRefreshing({ children, isRefreshing }: { children: React.ReactNode; isRefreshing: boolean }) {
	return (
		<div className='relative h-full'>
			<div className={cn('h-full transition-opacity duration-150', isRefreshing && 'opacity-50')}>{children}</div>
			{isRefreshing && (
				<div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
					<Loader2 className='size-5 animate-spin text-muted-foreground' />
				</div>
			)}
		</div>
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
	hasActiveFilters = false,
	isRefreshing = false,
}: {
	chart: ParsedChartBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
}) {
	const noCacheFetch = useLiveQueryData(chart.queryId, liveQuery);

	const resolved = liveQuery
		? (noCacheFetch.data as { data: Record<string, unknown>[]; columns: string[] } | undefined)
		: queryData?.[chart.queryId];
	const displayData = resolved?.data ?? [];
	const resolvedColumns = resolved?.columns ?? [];
	const showRefreshing = isRefreshing || Boolean(liveQuery && noCacheFetch.isFetching);

	if (liveQuery && noCacheFetch.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolved) {
		return <EmbedPlaceholder>Chart data unavailable</EmbedPlaceholder>;
	}

	if (displayData.length === 0) {
		return (
			<EmbedPlaceholder>
				{hasActiveFilters ? 'No results match the selected filters' : 'No data to display'}
			</EmbedPlaceholder>
		);
	}

	if (chart.series.length === 0) {
		return <EmbedPlaceholder>No series configured for chart</EmbedPlaceholder>;
	}

	return (
		<StoryChartEmbedShell chart={chart} availableColumns={resolvedColumns} data={displayData}>
			<EmbedRefreshing isRefreshing={showRefreshing}>
				<ChartDisplay
					data={displayData}
					chartType={chart.chartType as displayChart.ChartType}
					xAxisKey={chart.xAxisKey}
					xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
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
					animate
					normalSize
					hideTotal={chart.hideTotal}
				/>
			</EmbedRefreshing>
		</StoryChartEmbedShell>
	);
});

export const StoryMapEmbed = memo(function StoryMapEmbed({
	map,
	queryData,
	liveQuery,
	hasActiveFilters = false,
	isRefreshing = false,
	allowExpand,
}: {
	map: ParsedMapBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	allowExpand?: boolean;
}) {
	const noCacheFetch = useLiveQueryData(map.queryId, liveQuery);

	const resolved = liveQuery
		? (noCacheFetch.data as { data: Record<string, unknown>[]; columns: string[] } | undefined)
		: queryData?.[map.queryId];
	const displayData = resolved?.data ?? [];
	const showRefreshing = isRefreshing || Boolean(liveQuery && noCacheFetch.isFetching);

	if (liveQuery && noCacheFetch.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolved) {
		return <EmbedPlaceholder>Map data unavailable</EmbedPlaceholder>;
	}

	if (displayData.length === 0) {
		return (
			<EmbedPlaceholder>
				{hasActiveFilters ? 'No results match the selected filters' : 'No data to display'}
			</EmbedPlaceholder>
		);
	}

	return (
		<StoryMapEmbedShell map={map} allowExpand={allowExpand}>
			<EmbedRefreshing isRefreshing={showRefreshing}>
				<StoryMapRender map={map} data={displayData} />
			</EmbedRefreshing>
		</StoryMapEmbedShell>
	);
});

export const StoryTableEmbed = memo(function StoryTableEmbed({
	table,
	queryData,
	liveQuery,
	hasActiveFilters = false,
	isRefreshing = false,
}: {
	table: ParsedTableBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
}) {
	const noCacheFetch = useLiveQueryData(table.queryId, liveQuery);

	const resolvedResult = liveQuery
		? (noCacheFetch.data as { data: Record<string, unknown>[]; columns: string[] } | undefined)
		: queryData?.[table.queryId];
	const showRefreshing = isRefreshing || Boolean(liveQuery && noCacheFetch.isFetching);

	if (liveQuery && noCacheFetch.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolvedResult) {
		return <EmbedPlaceholder>Table data unavailable</EmbedPlaceholder>;
	}

	if (!resolvedResult.data || resolvedResult.data.length === 0) {
		return (
			<EmbedPlaceholder>
				{hasActiveFilters ? 'No results match the selected filters' : 'No data to display'}
			</EmbedPlaceholder>
		);
	}

	const columns = resolvedResult.columns ?? [];
	return (
		<EmbedRefreshing isRefreshing={showRefreshing}>
			<DataTableCard
				data={resolvedResult.data}
				columns={columns}
				title={table.title}
				conditionalFormats={table.conditionalFormats}
				headerActions={<StoryTableEditControls table={table} data={resolvedResult.data} columns={columns} />}
			/>
		</EmbedRefreshing>
	);
});
