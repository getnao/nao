import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { incompleteMapMessage } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { ChartType } from '@nao/shared/chart-types';

import { DataTableCard } from '@/components/data-table-card';
import GraphLoaderAnimated from '@/components/icons/graph-loader-animated';
import { StoryChartEmbedShell } from '@/components/side-panel/story-chart-embed';
import { StoryChartFilterFailure } from '@/components/side-panel/story-chart-query';
import { StoryMapEmbedShell } from '@/components/side-panel/story-map-embed';
import { StoryTableEditControls } from '@/components/side-panel/story-table-embed';
import { StoryMapRender } from '@/components/story-map-embed';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useSourceQuery } from '@/hooks/use-source-query';
import { sortByDateKey } from '@/lib/charts.utils';
import { cn } from '@/lib/utils';

export type QueryDataMap = Record<string, { data: Record<string, unknown>[]; columns: string[] }>;
type EmbedData = QueryDataMap[string];

export interface LiveQueryConfig {
	queryOptions: (queryId: string) => object;
}

function EmbedPlaceholder({ children }: { children: React.ReactNode }) {
	return (
		<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
			{children}
		</div>
	);
}

/** A stand-in with the size of a story chart, so a block that is still loading does not shift the layout. */
export function StoryBlockSkeleton({ block = 'chart' }: { block?: 'chart' | 'map' }) {
	return (
		<div className='my-2 flex flex-col gap-4'>
			<div className='flex h-6 items-center'>
				<Skeleton className='h-4 w-1/3' />
			</div>
			<Skeleton
				className={cn('flex w-full items-center justify-center', block === 'map' ? 'aspect-3/2' : 'h-72')}
			>
				<GraphLoaderAnimated className='h-auto w-4/5 max-w-96 text-muted-foreground' />
			</Skeleton>
		</div>
	);
}

const TABLE_SKELETON_ROW_COUNT = 6;

/** A stand-in shaped like a story table, so it is not mistaken for a chart while loading. */
export function StoryTableSkeleton() {
	return (
		<div className='my-2 flex flex-col gap-2 rounded-lg border p-3'>
			<Skeleton className='mb-2 h-4 w-1/3' />
			{Array.from({ length: TABLE_SKELETON_ROW_COUNT }, (_, index) => (
				<Skeleton key={index} className='h-6 w-full' />
			))}
		</div>
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
		...(liveQuery ? liveQuery.queryOptions(queryId) : {}),
		...(liveQuery ? { staleTime: 0, refetchOnWindowFocus: false, enabled: true } : {}),
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
	unavailableMessage,
}: {
	chart: ParsedChartBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
	unavailableMessage?: string;
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
		return <StoryBlockSkeleton />;
	}

	if (!resolved) {
		if (isStreaming || isDataPending) {
			return <StoryBlockSkeleton />;
		}
		return (
			<StoryChartFilterFailure queryId={chart.queryId}>
				<EmbedPlaceholder>
					{unavailableMessage ?? `Chart data unavailable (query: ${chart.queryId})`}
				</EmbedPlaceholder>
			</StoryChartFilterFailure>
		);
	}

	if (displayData.length === 0) {
		return (
			<StoryChartFilterFailure queryId={chart.queryId}>
				<EmbedPlaceholder>
					{hasActiveFilters ? 'No results match the selected filters' : 'No data to display'}
				</EmbedPlaceholder>
			</StoryChartFilterFailure>
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
					chartType={chart.chartType as ChartType}
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
					showLegend={chart.showLegend}
					comparisonMode={chart.comparisonMode}
					animate
					normalSize
					hideTotal={chart.hideTotal}
					breakdownKey={chart.breakdownKey}
					breakdownLimit={chart.breakdownLimit}
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
	unavailableMessage,
}: {
	map: ParsedMapBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
	allowExpand?: boolean;
	unavailableMessage?: string;
}) {
	const resolvedData = useResolvedEmbedData(map.queryId, { queryData, liveQuery });
	const resolved = resolvedData.data;
	const displayData = resolved?.data ?? [];
	const showRefreshing = isRefreshing || resolvedData.isFetching;

	// Outside the shell: the map edit dialog has no column fields, so it cannot add the missing ones.
	if (map.missingAttributes) {
		return <EmbedPlaceholder>{incompleteMapMessage(map)}</EmbedPlaceholder>;
	}

	if (resolvedData.isLoading) {
		return <StoryBlockSkeleton block='map' />;
	}

	if (!resolved) {
		if (isStreaming || isDataPending) {
			return <StoryBlockSkeleton block='map' />;
		}
		return (
			<EmbedPlaceholder>{unavailableMessage ?? `Map data unavailable (query: ${map.queryId})`}</EmbedPlaceholder>
		);
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
	unavailableMessage,
}: {
	table: ParsedTableBlock;
	queryData?: QueryDataMap | null;
	liveQuery?: LiveQueryConfig;
	hasActiveFilters?: boolean;
	isRefreshing?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
	unavailableMessage?: string;
}) {
	const resolvedData = useResolvedEmbedData(table.queryId, { queryData, liveQuery });
	const resolvedResult = resolvedData.data;
	const showRefreshing = isRefreshing || resolvedData.isFetching;

	if (resolvedData.isLoading) {
		return <StoryTableSkeleton />;
	}

	if (!resolvedResult) {
		if (isStreaming || isDataPending) {
			return <StoryTableSkeleton />;
		}
		return (
			<EmbedPlaceholder>
				{unavailableMessage ?? `Table data unavailable (query: ${table.queryId})`}
			</EmbedPlaceholder>
		);
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
