import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { LiveQueryConfig, QueryDataMap } from '@/components/story-embeds';
import {
	StoryChartEmbed as LiveChartEmbed,
	StoryMapEmbed as LiveMapEmbed,
	StoryTableEmbed as LiveTableEmbed,
} from '@/components/story-embeds';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { StoryBlock, StoryMapFrame, StoryTableFrame } from '@/components/story-block';
import { SegmentList } from '@/components/story-rendering';
import { StoryQuerySqlProvider } from '@/contexts/story-query-sql';
import { useStoryFilters } from '@/hooks/use-story-filters';
import { stabilizeStorySegments } from '@/lib/story-segment-stability';
import { trpc } from '@/main';

interface StoryPreviewProps {
	code: string;
	fullCode?: string;
	cacheSchedule: string | null;
	queryData: QueryDataMap | null;
	chatId: string;
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
	storySlug,
	versionKey,
	filtersEnabled = true,
	isStreaming = false,
	isDataPending = false,
	isViewingLatest = true,
	theme,
}: StoryPreviewProps) {
	const previousSegmentsRef = useRef<ReturnType<typeof splitCodeIntoSegments>>([]);
	const segments = useMemo(() => {
		const nextSegments = stabilizeStorySegments(splitCodeIntoSegments(code), previousSegmentsRef.current);
		previousSegmentsRef.current = nextSegments;
		return nextSegments;
	}, [code]);
	const isNoCacheMode = cacheSchedule === NO_CACHE_SCHEDULE;
	const filterApi = useMemo(() => ({ kind: 'owned' as const, chatId, storySlug }), [chatId, storySlug]);
	const storyFilters = useStoryFilters({
		code: fullCode ?? code,
		baselineQueryData: queryData,
		api: filterApi,
		enabled: filtersEnabled,
	});

	const noCacheQuery = useMemo<LiveQueryConfig | undefined>(
		() =>
			isNoCacheMode
				? { queryOptions: (queryId) => trpc.story.getLiveQueryData.queryOptions({ chatId, queryId }) }
				: undefined,
		[isNoCacheMode, chatId],
	);

	const effectiveQueryData = storyFilters.queryData;

	const useLiveUnfiltered = isViewingLatest && isNoCacheMode && !storyFilters.hasActiveFilters;
	const querySqlSource = useMemo(
		() =>
			filtersEnabled
				? {
						api: filterApi,
						selections: storyFilters.debouncedSelections,
					}
				: null,
		[filterApi, filtersEnabled, storyFilters.debouncedSelections],
	);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => (
			<StoryBlock>
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
			<StoryTableFrame>
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
			<StoryMapFrame>
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
				<div data-story-content className='p-6 flex flex-col gap-4'>
					<StoryFilterBar
						filters={storyFilters.filters}
						selections={storyFilters.selections}
						onSelectionChange={storyFilters.setSelection}
						onClear={storyFilters.clearSelections}
						api={filterApi}
					/>
					<SegmentList
						segments={segments}
						versionKey={versionKey}
						renderChart={renderChart}
						renderTable={renderTable}
						renderMap={renderMap}
					/>
				</div>
			</StoryThemeProvider>
		</StoryQuerySqlProvider>
	);
});
