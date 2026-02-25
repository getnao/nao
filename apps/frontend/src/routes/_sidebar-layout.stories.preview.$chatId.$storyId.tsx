import { useCallback, useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import type { displayChart } from '@nao/shared/tools';
import type { ParsedChartBlock, ParsedTableBlock } from '@/lib/story-segments';
import { splitCodeIntoSegments } from '@/lib/story-segments';
import { SegmentList } from '@/components/story-rendering';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/preview/$chatId/$storyId')({
	component: StoryPreviewPage,
});

function StoryPreviewPage() {
	const { chatId, storyId } = Route.useParams();
	const { data: story } = useSuspenseQuery(trpc.story.getLatest.queryOptions({ chatId, storyId }));

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel'>
			<header className='flex items-center gap-3 border-b px-6 py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{story.title}</h1>
				<Button variant='outline' size='sm' className='ml-auto gap-1.5 shrink-0' asChild>
					<Link to='/$chatId' params={{ chatId }} state={{ openStoryId: storyId }}>
						<MessageSquare className='size-3.5' />
						<span>Open chat</span>
					</Link>
				</Button>
			</header>

			<PreviewContent
				code={story.code}
				queryData={
					story.queryData as Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null
				}
			/>
		</div>
	);
}

function PreviewContent({
	code,
	queryData,
}: {
	code: string;
	queryData: Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <PreviewChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);
	const renderTable = useCallback(
		(table: ParsedTableBlock) => <PreviewTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}

function PreviewChartEmbed({
	chart,
	queryData,
}: {
	chart: ParsedChartBlock;
	queryData: Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null;
}) {
	const result = queryData?.[chart.queryId];
	const data = result?.data;

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

function PreviewTableEmbed({
	table,
	queryData,
}: {
	table: ParsedTableBlock;
	queryData: Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null;
}) {
	const result = queryData?.[table.queryId];
	const data = result?.data;

	if (!data) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Table data unavailable
			</div>
		);
	}

	return (
		<TableDisplay
			data={data}
			columns={result.columns}
			title={table.title}
			tableContainerClassName='max-h-[28rem]'
		/>
	);
}
