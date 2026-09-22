import { useMemo, useState } from 'react';
import { parseStoryTabs, stripStoryTabsMarkup } from '@nao/shared/story-tabs';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryFilterApi } from '@/hooks/use-story-filters';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { StoryTabsBar } from '@/components/side-panel/story-tabs-bar';
import { SegmentList } from '@/components/story-rendering';
import { StoryQuerySqlProvider } from '@/contexts/story-query-sql';
import { useStoryFilters } from '@/hooks/use-story-filters';

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
}

export function StoryTabbedContent({
	code,
	renderChart,
	renderTable,
	renderMap,
	contentClassName = 'max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4',
	baselineQueryData,
	filterApi,
}: StoryTabbedContentProps) {
	const tabs = useMemo(() => parseStoryTabs(code), [code]);
	const [activeIndex, setActiveIndex] = useState(0);
	const isTabbed = Boolean(tabs?.length);
	const activeTabIndex = tabs?.length ? Math.min(activeIndex, tabs.length - 1) : 0;
	const activeCode = isTabbed && tabs ? tabs[activeTabIndex].innerCode : stripStoryTabsMarkup(code);
	const segments = useMemo(() => splitCodeIntoSegments(activeCode), [activeCode]);
	const storyFilters = useStoryFilters({
		code,
		baselineQueryData,
		api: filterApi,
		enabled: Boolean(filterApi),
	});
	const querySqlSource = useMemo(
		() =>
			filterApi
				? {
						api: filterApi,
						selections: storyFilters.filtersEnabled ? storyFilters.debouncedSelections : {},
					}
				: null,
		[filterApi, storyFilters.filtersEnabled, storyFilters.debouncedSelections],
	);

	return (
		<StoryQuerySqlProvider value={querySqlSource}>
			<div className='flex flex-1 min-h-0 flex-col'>
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
							selections={storyFilters.selections}
							onSelectionChange={storyFilters.setSelection}
							onClear={storyFilters.clearSelections}
							api={filterApi}
						/>
						<SegmentList
							segments={segments}
							renderChart={(chart, key) =>
								renderChart(chart, {
									queryData: storyFilters.queryData,
									hasActiveFilters: storyFilters.hasActiveFilters,
									isRefreshing: storyFilters.isFiltering,
									key,
								})
							}
							renderTable={(table, key) =>
								renderTable(table, {
									queryData: storyFilters.queryData,
									hasActiveFilters: storyFilters.hasActiveFilters,
									isRefreshing: storyFilters.isFiltering,
									key,
								})
							}
							renderMap={(map, key) =>
								renderMap(map, {
									queryData: storyFilters.queryData,
									hasActiveFilters: storyFilters.hasActiveFilters,
									isRefreshing: storyFilters.isFiltering,
									key,
								})
							}
						/>
					</div>
				</div>
			</div>
		</StoryQuerySqlProvider>
	);
}
