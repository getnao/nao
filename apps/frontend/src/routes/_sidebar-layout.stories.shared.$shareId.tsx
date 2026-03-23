import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Loader2, MessageSquare, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { displayChart } from '@nao/shared/tools';

import type { ParsedAnalysisBlock, ParsedChartBlock, ParsedTableBlock } from '@/lib/story-segments';
import { SegmentList } from '@/components/story-rendering';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/lib/auth-client';
import { splitCodeIntoSegments } from '@/lib/story-segments';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/shared/$shareId')({
	component: SharedStoryPage,
});

function SharedStoryPage() {
	const { shareId } = Route.useParams();
	const { data: session } = useSession();
	const queryClient = useQueryClient();

	const { data: story, isLoading } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ id: shareId }));

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ id: shareId }) });
			},
		}),
	);

	if (isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	const isOwner = session?.user?.id === story.userId;
	const cachedAt = story.cachedAt ? new Date(story.cachedAt as unknown as string) : null;

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel min-w-0'>
			<header className='flex items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{story.title}</h1>
				<span className='text-sm text-muted-foreground shrink-0'>by {story.authorName}</span>
				{story.isLive && (
					<div className='flex items-center gap-1.5'>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className='flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700'>
										<Activity className='size-3' />
										<span>Live</span>
									</div>
								</TooltipTrigger>
								<TooltipContent>
									{cachedAt
										? `Data cached ${cachedAt.toLocaleString()}`
										: 'Live story with fresh data'}
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant='ghost-muted'
										size='icon-xs'
										onClick={() => refreshMutation.mutate({ id: shareId })}
										disabled={refreshMutation.isPending}
										aria-label='Refresh data'
									>
										{refreshMutation.isPending ? (
											<Loader2 className='size-3.5 animate-spin' />
										) : (
											<RefreshCw className='size-3.5' />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent>Refresh data</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
				)}
				{isOwner && (
					<Button variant='outline' size='sm' className='ml-auto gap-1.5 shrink-0' asChild>
						<Link to='/$chatId' params={{ chatId: story.chatId }} state={{ openStoryId: story.storyId }}>
							<MessageSquare className='size-3.5' />
							<span>Open chat</span>
						</Link>
					</Button>
				)}
			</header>

			<SharedStoryContent
				code={story.code}
				analysisResults={story.analysisResults}
				queryData={
					story.queryData as Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null
				}
				chatId={story.chatId}
				cacheSchedule={story.cacheSchedule}
			/>
		</div>
	);
}

function SharedStoryContent({
	code,
	queryData,
	analysisResults,
	chatId,
	cacheSchedule,
}: {
	code: string;
	queryData: Record<string, { data: Record<string, unknown>[]; columns: string[] }> | null;
	analysisResults: Record<string, string> | null;
	chatId: string;
	cacheSchedule?: string | null;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	if (cacheSchedule === 'no-cache') {
		return <NoCacheSharedContent segments={segments} chatId={chatId} />;
	}

	const renderChart = (chart: ParsedChartBlock) => <SharedChartEmbed chart={chart} queryData={queryData} />;
	const renderTable = (table: ParsedTableBlock) => <SharedTableEmbed table={table} queryData={queryData} />;
	const renderAnalysis = (analysis: ParsedAnalysisBlock) => (
		<SharedAnalysisEmbed analysis={analysis} analysisResults={analysisResults} />
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4'>
				<SegmentList
					segments={segments}
					renderChart={renderChart}
					renderTable={renderTable}
					renderAnalysis={renderAnalysis}
				/>
			</div>
		</div>
	);
}

function SharedAnalysisEmbed({
	analysis,
	analysisResults,
}: {
	analysis: ParsedAnalysisBlock;
	analysisResults: Record<string, string> | null;
}) {
	const content = analysisResults?.[analysis.id];

	if (!content) {
		return (
			<div className='my-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 p-4 text-center text-sm text-muted-foreground'>
				<Sparkles className='size-4 inline-block mr-1.5 text-violet-500' />
				{analysis.prompt ? `Analysis: ${analysis.prompt}` : `Dynamic analysis (${analysis.id})`}
			</div>
		);
	}

	return (
		<div className='my-2 rounded-lg border border-violet-200 bg-violet-50/30 p-4'>
			<Streamdown mode='static'>{content}</Streamdown>
		</div>
	);
}

function NoCacheSharedContent({
	segments,
	chatId,
}: {
	segments: ReturnType<typeof splitCodeIntoSegments>;
	chatId: string;
}) {
	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <NoCacheSharedChartEmbed chart={chart} chatId={chatId} />,
		[chatId],
	);
	const renderTable = useCallback(
		(table: ParsedTableBlock) => <NoCacheSharedTableEmbed table={table} chatId={chatId} />,
		[chatId],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}

function NoCacheSharedChartEmbed({ chart, chatId }: { chart: ParsedChartBlock; chatId: string }) {
	const { data, isLoading } = useQuery({
		...trpc.storyShare.getLiveQueryData.queryOptions({ chatId, queryId: chart.queryId }),
		staleTime: 0,
	});

	if (isLoading) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 flex items-center justify-center text-sm text-muted-foreground'>
				<Loader2 className='size-4 animate-spin mr-2' />
				Loading live data...
			</div>
		);
	}

	const rows = data?.data as Record<string, unknown>[] | undefined;
	if (!rows || rows.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable
			</div>
		);
	}

	return (
		<div className={`my-2 ${chart.chartType !== 'kpi_card' ? 'aspect-3/2' : ''}`}>
			<ChartDisplay
				data={rows}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
}

function NoCacheSharedTableEmbed({ table, chatId }: { table: ParsedTableBlock; chatId: string }) {
	const { data, isLoading } = useQuery({
		...trpc.storyShare.getLiveQueryData.queryOptions({ chatId, queryId: table.queryId }),
		staleTime: 0,
	});

	if (isLoading) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 flex items-center justify-center text-sm text-muted-foreground'>
				<Loader2 className='size-4 animate-spin mr-2' />
				Loading live data...
			</div>
		);
	}

	if (!data?.data) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Table data unavailable
			</div>
		);
	}

	return (
		<TableDisplay
			data={data.data as Record<string, unknown>[]}
			columns={data.columns}
			title={table.title}
			tableContainerClassName='max-h-[28rem]'
		/>
	);
}

function SharedChartEmbed({
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
		<div className={`my-2 ${chart.chartType != 'kpi_card' ? 'aspect-3/2' : ''} `}>
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

function SharedTableEmbed({
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
