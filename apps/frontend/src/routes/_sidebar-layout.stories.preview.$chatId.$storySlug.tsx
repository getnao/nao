import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, ArchiveRestoreIcon, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { QueryDataMap } from '@/components/story-embeds';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/main';
import { StoryDownload } from '@/components/story-download';

export const Route = createFileRoute('/_sidebar-layout/stories/preview/$chatId/$storySlug')({
	component: StoryPreviewPage,
});

function StoryPreviewPage() {
	const { chatId, storySlug } = Route.useParams();
	const { data: story } = useSuspenseQuery(trpc.story.getLatest.queryOptions({ chatId, storySlug }));
	const queryClient = useQueryClient();

	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }) });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	const refreshMutation = useMutation(
		trpc.story.refreshData.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }) });
			},
		}),
	);

	const cachedAt = story.cachedAt ? new Date(story.cachedAt as unknown as string) : null;

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel min-w-0'>
			<header className='flex items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{story.title}</h1>
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
										onClick={() => refreshMutation.mutate({ chatId, storySlug })}
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
				<div className='ml-auto flex items-center gap-1.5 shrink-0'>
					<StoryDownload chatId={chatId} storySlug={storySlug} isOwner={true} isIconMode={false} />
					<Button variant='outline' size='sm' className='gap-1.5' asChild>
						<Link to='/$chatId' params={{ chatId }} state={{ openStorySlug: storySlug }}>
							<MessageSquare className='size-3.5' />
							<span>Open chat</span>
						</Link>
					</Button>
				</div>
			</header>

			{story.archivedAt && (
				<div className='flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 md:px-6'>
					<span className='text-xs text-muted-foreground'>This story has been archived.</span>
					<Button
						variant='outline'
						size='sm'
						className='gap-1.5 shrink-0'
						onClick={() => unarchiveMutation.mutate({ chatId, storySlug })}
						disabled={unarchiveMutation.isPending}
					>
						<ArchiveRestoreIcon className='size-3' />
						<span>Unarchive</span>
					</Button>
				</div>
			)}

			<PreviewContent
				code={story.code}
				queryData={story.queryData as QueryDataMap | null}
				chatId={chatId}
				cacheSchedule={story.cacheSchedule}
			/>
		</div>
	);
}

function PreviewContent({
	code,
	queryData,
	chatId,
	cacheSchedule,
}: {
	code: string;
	queryData: QueryDataMap | null;
	chatId: string;
	cacheSchedule?: string | null;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const isNoCacheMode = cacheSchedule === 'no-cache';

	const noCacheQuery = useMemo(
		() => (isNoCacheMode ? { queryOptions: trpc.story.getLiveQueryData.queryOptions, chatId } : undefined),
		[isNoCacheMode, chatId],
	);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => (
			<StoryChartEmbed chart={chart} queryData={isNoCacheMode ? undefined : queryData} liveQuery={noCacheQuery} />
		),
		[isNoCacheMode, queryData, noCacheQuery],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => (
			<StoryTableEmbed table={table} queryData={isNoCacheMode ? undefined : queryData} liveQuery={noCacheQuery} />
		),
		[isNoCacheMode, queryData, noCacheQuery],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}
