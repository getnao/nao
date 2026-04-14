import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Activity, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { HighlightBubble } from '@/components/highlight-bubble';
import { SelectionChatPanel } from '@/components/selection-chat-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { StoryDownload } from '@/components/story-download';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';
import { useSidePanel } from '@/hooks/use-side-panel';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/shared/$shareId')({
	component: SharedStoryPage,
});

function SharedStoryPage() {
	const { shareId } = Route.useParams();
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const { data: story, isLoading } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ id: shareId }));

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const contentAreaRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({ containerRef, sidePanelRef });

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ id: shareId }) });
			},
		}),
	);

	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: ({ chatId }) => {
				navigate({ to: '/$chatId', params: { chatId } });
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
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStorySlug={sidePanel.currentStorySlug}
			chatId={story.chatId}
			shareId={shareId}
			isReadonlyMode={!isOwner}
			open={sidePanel.open}
			close={sidePanel.close}
		>
			<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel min-w-0' ref={containerRef}>
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
					<div className='ml-auto flex items-center gap-1.5 shrink-0'>
						<StoryDownload chatId={story.chatId} storySlug={story.slug} shareId={shareId} isOwner={false} />
						{isOwner ? (
							<Button variant='outline' size='sm' className='gap-1.5 shrink-0' asChild>
								<Link
									to='/$chatId'
									params={{ chatId: story.chatId }}
									state={{ openStorySlug: story.slug }}
								>
									<MessageSquare className='size-3.5' />
									<span>Open chat</span>
								</Link>
							</Button>
						) : (
							<Button
								variant='outline'
								size='sm'
								className='ml-auto gap-1.5 shrink-0'
								onClick={() => forkMutation.mutate({ shareId, type: 'story' })}
								disabled={forkMutation.isPending}
							>
								{forkMutation.isPending ? (
									<Loader2 className='size-3.5 animate-spin' />
								) : (
									<MessageSquare className='size-3.5' />
								)}
								<span>Discuss story</span>
							</Button>
						)}
					</div>
				</header>

				<SelectionProvider key={shareId} persistenceConfig={{ shareId, contentType: 'story' }}>
					<HighlightBubble shareId={shareId} contentType='story' />
					<SelectionChatPanel contentAreaRef={contentAreaRef} />
					<div className='flex flex-1 min-h-0 min-w-0'>
						<div ref={contentAreaRef} className='flex flex-col flex-1 min-w-0 min-h-0'>
							<SharedStoryContent
								code={story.code}
								queryData={story.queryData as QueryDataMap | null}
								chatId={story.chatId}
								cacheSchedule={story.cacheSchedule}
							/>
						</div>

						{sidePanel.content && (
							<SidePanel
								containerRef={containerRef}
								isAnimating={sidePanel.isAnimating}
								sidePanelRef={sidePanelRef}
								resizeHandleRef={sidePanel.resizeHandleRef}
								onClose={sidePanel.close}
							>
								{sidePanel.content}
							</SidePanel>
						)}
					</div>
				</SelectionProvider>
			</div>
		</SidePanelProvider>
	);
}

function SharedStoryContent({
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
		() => (isNoCacheMode ? { queryOptions: trpc.storyShare.getLiveQueryData.queryOptions, chatId } : undefined),
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
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4' data-selection-container>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}
