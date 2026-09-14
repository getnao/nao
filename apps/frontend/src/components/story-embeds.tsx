import { Loader2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import { StoryChartEmbedShell } from '@/components/side-panel/story-chart-embed';
import { StoryMapEmbedShell } from '@/components/side-panel/story-map-embed';
import { StoryTableEditControls } from '@/components/side-panel/story-table-embed';
import { StoryMapRender } from '@/components/story-map-embed';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { DataTableCard } from '@/components/data-table-card';
import { useSourceQuery } from '@/hooks/use-source-query';
import { sortByDateKey } from '@/lib/charts.utils';
import { cn } from '@/lib/utils';

export type QueryDataMap = Record<string, { data: Record<string, unknown>[]; columns: string[] }>;
type EmbedData = QueryDataMap[string];

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

function EmbedLoading({ label = 'Loading live data...' }: { label?: string }) {
	return (
		<EmbedPlaceholder>
			<span className='flex items-center justify-center'>
				<Loader2 className='size-4 animate-spin mr-2' />
				{label}
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

function useResolvedEmbedData(
	queryId: string,
	{ queryData, liveQuery }: { queryData?: QueryDataMap | null; liveQuery?: LiveQueryConfig },
) {
	const liveQueryData = useLiveQueryData(queryId, liveQuery);
	const savedData = liveQuery ? undefined : queryData?.[queryId];
	const { sourceData } = useSourceQuery(!liveQuery && !savedData ? queryId : undefined);
	const fallbackData = sourceData
		? ({ data: sourceData.data, columns: sourceData.columns ?? [] } satisfies EmbedData)
		: undefined;

	return {
		data: liveQuery ? (liveQueryData.data as EmbedData | undefined) : (savedData ?? fallbackData),
		isLoading: Boolean(liveQuery && liveQueryData.isLoading),
		isFetching: Boolean(liveQuery && liveQueryData.isFetching),
	};
}

export const StoryChartEmbed = memo(function StoryChartEmbed({
	chart,
	queryData,
	liveQuery,
	hasActiveFilters = false,
	isRefreshing = false,
	isStreaming = false,
	isDataPending = false,
}: {
	chart: ParsedChartBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
}) {
	const resolvedData = useResolvedEmbedData(chart.queryId, { queryData, liveQuery });
	const resolved = resolvedData.data;
	const displayData = useMemo(
		() =>
			resolved?.data && chart.xAxisType === 'date'
				? sortByDateKey(resolved.data, chart.xAxisKey)
				: (resolved?.data ?? []),
		[resolved?.data, chart.xAxisKey, chart.xAxisType],
	);
	const resolvedColumns = resolved?.columns ?? [];
	const showRefreshing = isRefreshing || resolvedData.isFetching;

	if (resolvedData.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolved) {
		if (isStreaming || isDataPending) {
			return <EmbedLoading label='Loading data...' />;
		}
		return <EmbedPlaceholder>Chart data unavailable (query: {chart.queryId})</EmbedPlaceholder>;
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
		<StoryChartEmbedShell chart={chart} availableColumns={resolvedColumns} data={resolved.data}>
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
	isStreaming = false,
	isDataPending = false,
	allowExpand,
}: {
	map: ParsedMapBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
	allowExpand?: boolean;
}) {
	const resolvedData = useResolvedEmbedData(map.queryId, { queryData, liveQuery });
	const resolved = resolvedData.data;
	const displayData = resolved?.data ?? [];
	const showRefreshing = isRefreshing || resolvedData.isFetching;

	if (resolvedData.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolved) {
		if (isStreaming || isDataPending) {
			return <EmbedLoading label='Loading data...' />;
		}
		return <EmbedPlaceholder>Map data unavailable (query: {map.queryId})</EmbedPlaceholder>;
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
	isStreaming = false,
	isDataPending = false,
}: {
	table: ParsedTableBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
}) {
	const resolvedData = useResolvedEmbedData(table.queryId, { queryData, liveQuery });
	const resolvedResult = resolvedData.data;
	const showRefreshing = isRefreshing || resolvedData.isFetching;

	if (resolvedData.isLoading) {
		return <EmbedLoading />;
	}

	if (!resolvedResult) {
		if (isStreaming || isDataPending) {
			return <EmbedLoading label='Loading data...' />;
		}
		return <EmbedPlaceholder>Table data unavailable (query: {table.queryId})</EmbedPlaceholder>;
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
