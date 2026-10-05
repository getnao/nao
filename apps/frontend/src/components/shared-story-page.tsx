import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryPageHeaderProps, StoryRefreshFailure } from '@/components/story-page-header';
import { SharedCustomStoryPage } from '@/components/custom-story/custom-story-page';
import { ForkBubble } from '@/components/highlight-bubble';
import { SelectionChatPanel } from '@/components/selection-chat-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { StorySubscriptionDialog } from '@/components/side-panel/story-subscription-dialog';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryPageBody } from '@/components/story-page-body';
import { StoryPageHeader } from '@/components/story-page-header';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';
import { useSidePanel } from '@/hooks/use-side-panel';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function SharedStoryPage({ storyId }: { storyId: string }) {
	const { data: story } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ storyId }));
	if (story.format === 'custom') {
		return <SharedCustomStory storyId={storyId} />;
	}
	return <SharedClassicStoryPage storyId={storyId} />;
}

function SharedCustomStory({ storyId }: { storyId: string }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { data: story } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ storyId }));
	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				navigate({ to: '/$chatId', params: { chatId } });
			},
		}),
	);

	useTrackViewDuration({
		assetType: 'story',
		storyId,
		chatId: story.chatId ?? undefined,
		storySlug: story.slug,
	});

	return (
		<SharedCustomStoryPage
			storyId={storyId}
			title={story.title}
			authorName={story.authorName}
			isLive={story.isLive}
			canRefresh={story.canRefresh}
			onOpenChat={story.canFork ? () => forkMutation.mutate({ source: { type: 'story', storyId } }) : undefined}
			isOpeningChat={forkMutation.isPending}
		/>
	);
}

function SharedClassicStoryPage({ storyId }: { storyId: string }) {
	const { data: session } = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const { data: story } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ storyId }));

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const contentAreaRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({ containerRef, sidePanelRef });
	const shareSource = useMemo(() => ({ type: 'story' as const, storyId }), [storyId]);

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSettled: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ storyId }) });
			},
		}),
	);

	const forkMutation = useMutation(
		trpc.chatFork.fork.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				navigate({ to: '/$chatId', params: { chatId } });
			},
		}),
	);

	const canFork = story?.canFork === true;

	useTrackViewDuration({
		assetType: 'story',
		storyId,
		chatId: story?.chatId ?? undefined,
		storySlug: story?.slug,
	});

	const editor = useStoryPageEditor({
		chatId: story?.chatId ?? '',
		storySlug: story?.slug ?? '',
		storyTitle: story?.title ?? '',
		latestCode: story?.code ?? '',
		isReadonlyMode: true,
	});
	const { queryData, isPending: isQueryDataPending } = useStoryVersionQueryData({
		chatId: story?.chatId ?? '',
		storySlug: story?.slug ?? '',
		versionNumber: editor.versionNav.storedVersionNumber,
		isViewingLatest: editor.versionNav.isViewingLatest,
		latestQueryData: (story?.queryData as QueryDataMap | null | undefined) ?? null,
		sharedStoryId: storyId,
	});

	return (
		<SidePanelProvider
			isVisible={sidePanel.isVisible}
			currentStorySlug={sidePanel.currentStorySlug}
			setCurrentStorySlug={sidePanel.setCurrentStorySlug}
			currentStoryTabIndex={sidePanel.currentStoryTabIndex}
			setCurrentStoryTabIndex={sidePanel.setCurrentStoryTabIndex}
			chatId={story.chatId}
			shareSource={shareSource}
			isReadonlyMode
			open={sidePanel.open}
			close={sidePanel.close}
		>
			<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0' ref={containerRef}>
				<SharedStoryViewerHeader
					title={story.title}
					authorName={story.authorName}
					onOpenChat={canFork ? () => forkMutation.mutate({ source: shareSource }) : undefined}
					isOpeningChat={forkMutation.isPending}
					isLive={story.isLive}
					cachedAt={story.cachedAt}
					lastRefreshFailure={story.lastRefreshFailure}
					isRefreshing={refreshMutation.isPending}
					canRefresh={story.canRefresh}
					onRefresh={() => refreshMutation.mutate({ storyId })}
					storyId={session?.user?.id ? storyId : null}
					download={{ chatId: story.chatId!, storySlug: story.slug, shareSource, isOwner: false }}
				/>

				<SelectionProvider key={storyId} persistenceSource={shareSource}>
					{canFork && <ForkBubble source={shareSource} />}
					{canFork && <SelectionChatPanel contentAreaRef={contentAreaRef} />}
					<div className='flex flex-1 min-h-0 min-w-0'>
						<div ref={contentAreaRef} className='flex flex-col flex-1 min-w-0 min-h-0'>
							<StoryPageBody
								editor={editor}
								queryData={queryData}
								preview={
									<SharedStoryContent
										code={editor.code}
										queryData={queryData}
										chatId={story.chatId!}
										storyId={storyId}
										cacheSchedule={story.cacheSchedule}
										isDataPending={isQueryDataPending}
										isViewingLatest={editor.versionNav.isViewingLatest}
									/>
								}
							/>
						</div>

						{sidePanel.content && (
							<SidePanel
								containerRef={containerRef}
								isAnimating={sidePanel.isAnimating}
								sidePanelRef={sidePanelRef}
								resizeHandleRef={sidePanel.resizeHandleRef}
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

interface SharedStoryViewerHeaderProps {
	title: string;
	authorName: string;
	onOpenChat?: () => void;
	isOpeningChat: boolean;
	isLive: boolean;
	cachedAt?: string | Date | null;
	lastRefreshFailure?: StoryRefreshFailure | null;
	isRefreshing: boolean;
	canRefresh: boolean;
	onRefresh: () => void;
	storyId: string | null;
	download: StoryPageHeaderProps['download'];
}

function SharedStoryViewerHeader({
	title,
	authorName,
	onOpenChat,
	isOpeningChat,
	isLive,
	cachedAt,
	lastRefreshFailure,
	isRefreshing,
	canRefresh,
	onRefresh,
	storyId,
	download,
}: SharedStoryViewerHeaderProps) {
	const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
	const canManageNotifications = isLive && Boolean(storyId);

	return (
		<>
			<StoryPageHeader
				title={title}
				authorName={authorName}
				openChatLabel='Discuss story'
				onOpenChat={onOpenChat}
				isOpeningChat={isOpeningChat}
				live={
					isLive
						? {
								isLive: true,
								cachedAt,
								lastRefreshFailure,
								isRefreshing,
								canRefresh,
								onRefresh,
								onOpenSettings: canManageNotifications ? () => setIsSubscriptionOpen(true) : undefined,
								isDialogNotifManager: true,
							}
						: undefined
				}
				download={download}
				storyId={storyId}
			/>

			{storyId && (
				<StorySubscriptionDialog
					open={isSubscriptionOpen}
					onOpenChange={setIsSubscriptionOpen}
					storyId={storyId}
				/>
			)}
		</>
	);
}

function SharedStoryContent({
	code,
	queryData,
	chatId,
	storyId,
	cacheSchedule,
	isDataPending,
	isViewingLatest,
}: {
	code: string;
	queryData: QueryDataMap | null;
	chatId: string;
	storyId: string;
	cacheSchedule?: string | null;
	isDataPending: boolean;
	isViewingLatest: boolean;
}) {
	const isNoCacheMode = cacheSchedule === 'no-cache';
	const useLiveUnfiltered = isViewingLatest && isNoCacheMode;
	const filterApi = useMemo(() => ({ kind: 'shared' as const, storyId }), [storyId]);

	const noCacheQuery = useMemo(
		() => (useLiveUnfiltered ? { queryOptions: trpc.storyShare.getLiveQueryData.queryOptions, chatId } : undefined),
		[useLiveUnfiltered, chatId],
	);

	const renderChart = useCallback(
		(
			chart: ParsedChartBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: {
				queryData: QueryDataMap | null;
				hasActiveFilters: boolean;
				isRefreshing: boolean;
			},
		) => (
			<StoryChartEmbed
				chart={chart}
				queryData={useLiveUnfiltered && !hasActiveFilters ? undefined : data}
				liveQuery={useLiveUnfiltered && !hasActiveFilters ? noCacheQuery : undefined}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending, noCacheQuery, useLiveUnfiltered],
	);

	const renderTable = useCallback(
		(
			table: ParsedTableBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryTableEmbed
				table={table}
				queryData={useLiveUnfiltered && !hasActiveFilters ? undefined : data}
				liveQuery={useLiveUnfiltered && !hasActiveFilters ? noCacheQuery : undefined}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending, noCacheQuery, useLiveUnfiltered],
	);

	const renderMap = useCallback(
		(
			map: ParsedMapBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryMapEmbed
				map={map}
				queryData={useLiveUnfiltered && !hasActiveFilters ? undefined : data}
				liveQuery={useLiveUnfiltered && !hasActiveFilters ? noCacheQuery : undefined}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
				allowExpand
			/>
		),
		[isDataPending, noCacheQuery, useLiveUnfiltered],
	);

	return (
		<div className='flex flex-1 min-h-0 flex-col' data-selection-container>
			<StoryTabbedContent
				code={code}
				baselineQueryData={queryData}
				filterApi={filterApi}
				renderChart={renderChart}
				renderTable={renderTable}
				renderMap={renderMap}
			/>
		</div>
	);
}
