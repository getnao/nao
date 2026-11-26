import { useCallback, useMemo, useRef } from 'react';
import { parseStoryTabs, stripStoryTabsMarkup } from '@nao/shared/story-tabs';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock, Segment } from '@nao/shared/story-segments';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { StoryTabsBar } from '@/components/side-panel/story-tabs-bar';
import {
	chartBlockReference,
	mapBlockReference,
	StoryBlock,
	StoryMapFrame,
	StoryTableFrame,
	tableBlockReference,
} from '@/components/story-block';
import { SegmentList } from '@/components/story-rendering';
import { StoryQuerySqlProvider } from '@/contexts/story-query-sql';
import { useActiveStoryTab } from '@/hooks/use-active-story-tab';
import { useStoryFilters } from '@/hooks/use-story-filters';
import { stabilizeStorySegments } from '@/lib/story-segment-stability';
import { useShowStoryFilters } from '@/stores/shown-story-filters';

export interface StoryEmbedRenderOptions {
	queryData: QueryDataMap | null;
	hasActiveFilters: boolean;
	isRefreshing: boolean;
	key: number;
}

interface StoryTabbedContentProps {
	code: string;
	renderChart: (chart: ParsedChartBlock, options: StoryEmbedRenderOptions) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, options: StoryEmbedRenderOptions) => React.ReactNode;
	renderMap: (map: ParsedMapBlock, options: StoryEmbedRenderOptions) => React.ReactNode;
	contentClassName?: string;
	baselineQueryData?: QueryDataMap | null;
	filterApi?: StoryFilterApi | null;
	theme?: StoryTheme | null;
	storyId: string | null;
	storySlug?: string;
}

export function StoryTabbedContent({
	code,
	renderChart,
	renderTable,
	renderMap,
	contentClassName = 'max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4',
	baselineQueryData,
	filterApi,
	theme,
	storyId,
	storySlug,
}: StoryTabbedContentProps) {
	const tabs = useMemo(() => parseStoryTabs(code), [code]);
	const [activeTabIndex, setActiveIndex] = useActiveStoryTab({ tabs, storySlug });
	const isTabbed = Boolean(tabs?.length);
	const activeCode = isTabbed && tabs ? tabs[activeTabIndex].innerCode : stripStoryTabsMarkup(code);
	const storyFilters = useStoryFilters({
		code,
		baselineQueryData,
		api: filterApi,
		enabled: Boolean(filterApi),
	});
	useShowStoryFilters(storyId, storyFilters.activeSelections);
	const previousSegmentsRef = useRef<Segment[]>([]);
	const segments = useMemo(() => {
		const nextSegments = stabilizeStorySegments(
			splitCodeIntoSegments(activeCode, storyFilters.resolvedParameters),
			previousSegmentsRef.current,
		);
		previousSegmentsRef.current = nextSegments;
		return nextSegments;
	}, [activeCode, storyFilters.resolvedParameters]);
	const { queryData, hasActiveFilters, isFiltering } = storyFilters;
	const renderChartBlock = useCallback(
		(chart: ParsedChartBlock, key: number) => (
			<StoryBlock block={chartBlockReference(chart)}>
				{renderChart(chart, { queryData, hasActiveFilters, isRefreshing: isFiltering, key })}
			</StoryBlock>
		),
		[renderChart, queryData, hasActiveFilters, isFiltering],
	);
	const renderTableBlock = useCallback(
		(table: ParsedTableBlock, key: number) => (
			<StoryTableFrame block={tableBlockReference(table)}>
				{renderTable(table, { queryData, hasActiveFilters, isRefreshing: isFiltering, key })}
			</StoryTableFrame>
		),
		[renderTable, queryData, hasActiveFilters, isFiltering],
	);
	const renderMapBlock = useCallback(
		(map: ParsedMapBlock, key: number) => (
			<StoryMapFrame block={mapBlockReference(map)}>
				{renderMap(map, { queryData, hasActiveFilters, isRefreshing: isFiltering, key })}
			</StoryMapFrame>
		),
		[renderMap, queryData, hasActiveFilters, isFiltering],
	);
	const querySqlSource = useMemo(
		() =>
			filterApi
				? {
						api: filterApi,
						selections: storyFilters.filtersEnabled ? storyFilters.debouncedSelections : {},
						filterSummary: storyFilters.filterSummary,
						queryFilterStatuses: storyFilters.queryFilterStatuses,
						filterTargets: storyFilters.filterTargets,
					}
				: null,
		[
			filterApi,
			storyFilters.filtersEnabled,
			storyFilters.debouncedSelections,
			storyFilters.filterSummary,
			storyFilters.queryFilterStatuses,
			storyFilters.filterTargets,
		],
	);

	return (
		<StoryQuerySqlProvider value={querySqlSource}>
			<StoryThemeProvider
				theme={theme ?? null}
				className='flex flex-1 min-h-0 flex-col bg-background text-foreground'
			>
				{isTabbed && tabs && (
					<StoryTabsBar
						tabs={tabs.map((tab) => ({ title: tab.title }))}
						activeIndex={activeTabIndex}
						onSelect={setActiveIndex}
						contentClassName='mx-auto w-full max-w-5xl px-4 md:px-8'
					/>
				)}
				<div className='flex-1 overflow-auto'>
					<div className={contentClassName}>
						<StoryFilterBar
							filters={storyFilters.filters}
							parameters={storyFilters.parameters}
							skippedFilters={storyFilters.skippedFilters}
							selections={storyFilters.selections}
							onSelectionChange={storyFilters.setSelection}
							onClear={storyFilters.clearSelections}
							api={filterApi}
						/>
						<SegmentList
							segments={segments}
							renderChart={renderChartBlock}
							renderTable={renderTableBlock}
							renderMap={renderMapBlock}
						/>
					</div>
					<div aria-hidden className='h-[var(--story-bottom-inset,0px)] shrink-0' />
				</div>
			</StoryThemeProvider>
		</StoryQuerySqlProvider>
	);
}
