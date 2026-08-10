import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { memo, useCallback, useMemo } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import {
	StoryChartEmbed as LiveChartEmbed,
	StoryMapEmbed as LiveMapEmbed,
	StoryTableEmbed as LiveTableEmbed,
} from '@/components/story-embeds';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { SegmentList } from '@/components/story-rendering';
import { StoryChartEmbed as StaticChartEmbed } from '@/components/side-panel/story-chart-embed';
import { StoryMapEmbed as StaticMapEmbed } from '@/components/side-panel/story-map-embed';
import { StoryTableEmbed as StaticTableEmbed } from '@/components/side-panel/story-table-embed';
import { StoryQuerySqlProvider } from '@/contexts/story-query-sql';
import { useStoryFilters } from '@/hooks/use-story-filters';
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
}: StoryPreviewProps) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const isNoCacheMode = cacheSchedule === NO_CACHE_SCHEDULE;
	const filterApi = useMemo(() => ({ kind: 'owned' as const, chatId, storySlug }), [chatId, storySlug]);
	const storyFilters = useStoryFilters({
		code: fullCode ?? code,
		baselineQueryData: queryData,
		api: filterApi,
		enabled: filtersEnabled,
	});

	const noCacheQuery = useMemo(
		() => (isNoCacheMode ? { queryOptions: trpc.story.getLiveQueryData.queryOptions, chatId } : undefined),
		[isNoCacheMode, chatId],
	);

	const effectiveQueryData = storyFilters.queryData;

	const useLiveUnfiltered = isNoCacheMode && !storyFilters.hasActiveFilters;
	const querySqlSource = useMemo(
		() => (storyFilters.filtersEnabled ? { api: filterApi, selections: storyFilters.debouncedSelections } : null),
		[filterApi, storyFilters.filtersEnabled, storyFilters.debouncedSelections],
	);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => {
			if (!effectiveQueryData && !useLiveUnfiltered) {
				return <StaticChartEmbed chart={chart} />;
			}
			return (
				<LiveChartEmbed
					chart={chart}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
				/>
			);
		},
		[effectiveQueryData, useLiveUnfiltered, noCacheQuery, storyFilters.hasActiveFilters, storyFilters.isFiltering],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => {
			if (!effectiveQueryData && !useLiveUnfiltered) {
				return <StaticTableEmbed table={table} />;
			}
			return (
				<LiveTableEmbed
					table={table}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
				/>
			);
		},
		[effectiveQueryData, useLiveUnfiltered, noCacheQuery, storyFilters.hasActiveFilters, storyFilters.isFiltering],
	);

	const renderMap = useCallback(
		(map: ParsedMapBlock) => {
			if (!effectiveQueryData && !useLiveUnfiltered) {
				return <StaticMapEmbed map={map} />;
			}
			return (
				<LiveMapEmbed
					map={map}
					queryData={useLiveUnfiltered ? undefined : effectiveQueryData}
					liveQuery={useLiveUnfiltered ? noCacheQuery : undefined}
					hasActiveFilters={storyFilters.hasActiveFilters}
					isRefreshing={storyFilters.isFiltering}
				/>
			);
		},
		[effectiveQueryData, useLiveUnfiltered, noCacheQuery, storyFilters.hasActiveFilters, storyFilters.isFiltering],
	);

	return (
		<StoryQuerySqlProvider value={querySqlSource}>
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
		</StoryQuerySqlProvider>
	);
});
