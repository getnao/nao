import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { useCallback, useMemo } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';

interface ReadonlyStoryContentProps {
	code: string;
	queryData: QueryDataMap | null;
	className?: string;
}

export function ReadonlyStoryContent({ code, queryData, className }: ReadonlyStoryContentProps) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => <StoryTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className={className ?? 'flex-1 overflow-auto'}>
			<div className='mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-8'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}

export function PublicStoryBanner() {
	return (
		<div className='rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground'>
			Public story — anyone with this link can view the data below without a nao account.
		</div>
	);
}
