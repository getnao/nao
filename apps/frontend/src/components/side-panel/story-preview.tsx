import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { LiveQueryConfig, QueryDataMap } from '@/components/story-embeds';
import type { PendingStoryBlock } from '@/lib/story.utils';
import {
	StoryChartEmbed as LiveChartEmbed,
	StoryMapEmbed as LiveMapEmbed,
	StoryTableEmbed as LiveTableEmbed,
} from '@/components/story-embeds';
import { StoryFilterBar, StoryFilterBarPlaceholder } from '@/components/story-filter-bar';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import {
	chartBlockReference,
	mapBlockReference,
	StoryBlock,
	StoryMapFrame,
	StoryTableFrame,
	tableBlockReference,
} from '@/components/story-block';
import { SegmentList } from '@/components/story-rendering';
import { VisualizationSkeleton } from '@/components/tool-calls/visualization-skeleton';
import { StoryQuerySqlProvider } from '@/contexts/story-query-sql';
import { useStoryFilters, useStreamingStoryFilterLabels } from '@/hooks/use-story-filters';
import { stabilizeStorySegments } from '@/lib/story-segment-stability';
import { holdBackIncompleteStoryBlock } from '@/lib/story.utils';
import { trpc } from '@/main';
import { useShowStoryFilters } from '@/stores/shown-story-filters';

const PENDING_BLOCK_LABELS: Record<PendingStoryBlock, string> = {
	chart: 'Loading chart',
	table: 'Loading table',
	map: 'Loading map',
	grid: 'Loading charts',
};

interface StoryPreviewProps {
	code: string;
	fullCode?: string;
	cacheSchedule: string | null;
	queryData: QueryDataMap | null;
	chatId: string;
	storyId: string | null;
	storySlug: string;
	versionKey?: string | number;
	filtersEnabled?: boolean;
	isStreaming?: boolean;
	isDataPending?: boolean;
	isViewingLatest?: boolean;
	theme?: StoryTheme | null;
}

export const StoryPreview = memo(function StoryPreview({
	code,
	fullCode,
	cacheSchedule,
	queryData,
	chatId,
	storyId,
	storySlug,
	versionKey,
	filtersEnabled = true,
	isStreaming = false,
	isDataPending = false,
	isViewingLatest = true,
	theme,
}: StoryPreviewProps) {
	const previousSegmentsRef = useRef<ReturnType<typeof splitCodeIntoSegments>>([]);
	const isNoCacheMode = cacheSchedule === NO_CACHE_SCHEDULE;
	const filterApi = useMemo(() => ({ kind: 'owned' as const, chatId, storySlug }), [chatId, storySlug]);
	const storyFilters = useStoryFilters({
		code: fullCode ?? code,
		baselineQueryData: queryData,
		api: filterApi,
		enabled: filtersEnabled,
	});
	const streamingFilterLabels = useStreamingStoryFilterLabels(fullCode ?? code, isStreaming);
	useShowStoryFilters(storyId, storyFilters.activeSelections);
	const { code: visibleCode, pendingBlock } = useMemo(
		() => (isStreaming ? holdBackIncompleteStoryBlock(code) : { code, pendingBlock: null }),
		[code, isStreaming],
	);
	const segments = useMemo(() => {
		const nextSegments = stabilizeStorySegments(
			splitCodeIntoSegments(visibleCode, storyFilters.resolvedParameters),
			previousSegmentsRef.current,
		);
		previousSegmentsRef.current = nextSegments;
		return nextSegments;
	}, [visibleCode, storyFilters.resolvedParameters]);

	const noCacheQuery = useMemo<LiveQueryConfig | undefined>(
		() =>
			isNoCacheMode
				? {
						queryOptions: (queryId) =>
							trpc.story.getLiveQueryData.queryOptions({ chatId, queryId, storySlug }),
					}
				: undefined,
		[isNoCacheMode, chatId, storySlug],
	);

	const effectiveQueryData = storyFilters.queryData;

	const useLiveUnfiltered = isViewingLatest && isNoCacheMode && !storyFilters.hasActiveFilters;
	const querySqlSource = useMemo(
		() =>
			filtersEnabled
				? {
						api: filterApi,
						selections: storyFilters.debouncedSelections,
						filterSummary: storyFilters.filterSummary,
						queryFilterStatuses: storyFilters.queryFilterStatuses,
						filterTargets: storyFilters.filterTargets,
					}
				: null,
		[
			filterApi,
			filtersEnabled,
			storyFilters.debouncedSelections,
			storyFilters.filterSummary,
			storyFilters.queryFilterStatuses,
			storyFilters.filterTargets,
		],
	);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => (
			<StoryBlock block={chartBlockReference(chart)}>
				<LiveChartEmbed
					chart={chart}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
					isStreaming={isStreaming}
					isDataPending={isDataPending}
				/>
			</StoryBlock>
		),
		[
			effectiveQueryData,
			useLiveUnfiltered,
			noCacheQuery,
			storyFilters.hasActiveFilters,
			storyFilters.isFiltering,
			isStreaming,
			isDataPending,
		],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => (
			<StoryTableFrame block={tableBlockReference(table)}>
				<LiveTableEmbed
					table={table}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
					isStreaming={isStreaming}
					isDataPending={isDataPending}
				/>
			</StoryTableFrame>
		),
		[
			effectiveQueryData,
			useLiveUnfiltered,
			noCacheQuery,
			storyFilters.hasActiveFilters,
			storyFilters.isFiltering,
			isStreaming,
			isDataPending,
		],
	);

	const renderMap = useCallback(
		(map: ParsedMapBlock) => (
			<StoryMapFrame block={mapBlockReference(map)}>
				<LiveMapEmbed
					map={map}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
					isStreaming={isStreaming}
					isDataPending={isDataPending}
				/>
			</StoryMapFrame>
		),
		[
			effectiveQueryData,
			useLiveUnfiltered,
			noCacheQuery,
			storyFilters.hasActiveFilters,
			storyFilters.isFiltering,
			isStreaming,
			isDataPending,
		],
	);

	return (
		<StoryQuerySqlProvider value={querySqlSource}>
			<StoryThemeProvider theme={theme ?? null} className='h-auto min-h-full bg-background text-foreground'>
				<div data-story-content data-story-chat-id={chatId} className='p-6 flex flex-col gap-4'>
					{isStreaming ? (
						<StoryFilterBarPlaceholder labels={streamingFilterLabels} />
					) : (
						<StoryFilterBar
							filters={storyFilters.filters}
							parameters={storyFilters.parameters}
							skippedFilters={storyFilters.skippedFilters}
							selections={storyFilters.selections}
							onSelectionChange={storyFilters.setSelection}
							onClear={storyFilters.clearSelections}
							api={filterApi}
						/>
					)}
					<SegmentList
						segments={segments}
						versionKey={versionKey}
						isStreaming={isStreaming}
						renderChart={renderChart}
						renderTable={renderTable}
						renderMap={renderMap}
					/>
					{pendingBlock && <VisualizationSkeleton label={PENDING_BLOCK_LABELS[pendingBlock]} />}
				</div>
			</StoryThemeProvider>
		</StoryQuerySqlProvider>
	);
});
