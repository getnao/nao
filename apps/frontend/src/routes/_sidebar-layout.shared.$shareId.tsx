import { useCallback, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock } from '@/lib/story-segments';
import { splitCodeIntoSegments } from '@/lib/story-segments';
import { SegmentList } from '@/components/story-rendering';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/shared/$shareId')({
	component: SharedStoryPage,
});

function SharedStoryPage() {
	const { shareId } = Route.useParams();

	const { data: story, isLoading } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ id: shareId }));

	if (isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel'>
			<header className='flex items-center gap-3 border-b px-6 py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{story.title}</h1>
				<span className='text-sm text-muted-foreground shrink-0'>by {story.authorName}</span>
			</header>

			<SharedStoryContent
				code={story.code}
				queryData={story.queryData as Record<string, Record<string, unknown>[]> | null}
			/>
		</div>
	);
}

function SharedStoryContent({
	code,
	queryData,
}: {
	code: string;
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <SharedChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} />
			</div>
		</div>
	);
}

function SharedChartEmbed({
	chart,
	queryData,
}: {
	chart: ParsedChartBlock;
	queryData: Record<string, Record<string, unknown>[]> | null;
}) {
	const data = queryData?.[chart.queryId];

	if (!data || data.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable
			</div>
		);
	}

	if (chart.series.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				No series configured for chart
			</div>
		);
	}

	return (
		<div className='my-2 aspect-3/2'>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
}
