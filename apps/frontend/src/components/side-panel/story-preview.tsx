import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { memo, useCallback, useMemo } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { StoryChartEmbed as LiveChartEmbed, StoryTableEmbed as LiveTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { StoryChartEmbed as StaticChartEmbed } from '@/components/side-panel/story-chart-embed';
import { StoryTableEmbed as StaticTableEmbed } from '@/components/side-panel/story-table-embed';
import { trpc } from '@/main';

interface StoryPreviewProps {
	code: string;
	cacheSchedule: string | null;
	queryData: QueryDataMap | null;
	chatId: string;
	versionKey?: string | number;
}

export const StoryPreview = memo(function StoryPreview({
	code,
	cacheSchedule,
	queryData,
	chatId,
	versionKey,
}: StoryPreviewProps) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const isNoCacheMode = cacheSchedule === NO_CACHE_SCHEDULE;

	const noCacheQuery = useMemo(
		() => (isNoCacheMode ? { queryOptions: trpc.story.getLiveQueryData.queryOptions, chatId } : undefined),
		[isNoCacheMode, chatId],
	);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => {
			if (!queryData && !isNoCacheMode) {
				return <StaticChartEmbed chart={chart} />;
			}
			return (
				<LiveChartEmbed
					chart={chart}
					queryData={isNoCacheMode ? undefined : queryData}
					liveQuery={noCacheQuery}
				/>
			);
		},
		[queryData, isNoCacheMode, noCacheQuery],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => {
			if (!queryData && !isNoCacheMode) {
				return <StaticTableEmbed table={table} />;
			}
			return (
				<LiveTableEmbed
					table={table}
					queryData={isNoCacheMode ? undefined : queryData}
					liveQuery={noCacheQuery}
				/>
			);
		},
		[queryData, isNoCacheMode, noCacheQuery],
	);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList
				segments={segments}
				versionKey={versionKey}
				renderChart={renderChart}
				renderTable={renderTable}
			/>
		</div>
	);
});
