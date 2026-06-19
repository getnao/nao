import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryPageHeaderProps } from '@/components/story-page-header';
import { ForkBubble } from '@/components/highlight-bubble';
import { SelectionChatPanel } from '@/components/selection-chat-panel';
import { SidePanel } from '@/components/side-panel/side-panel';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { StoryPageHeader } from '@/components/story-page-header';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { Spinner } from '@/components/ui/spinner';
import { SidePanelProvider } from '@/contexts/side-panel';
import { SelectionProvider } from '@/contexts/text-selection';
import { useSidePanel } from '@/hooks/use-side-panel';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
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

	const { data: story, isLoading } = useSuspenseQuery(trpc.storyShare.get.queryOptions({ shareId }));
	const isViewer = story?.userRole === 'viewer';

	const containerRef = useRef<HTMLDivElement>(null);
	const sidePanelRef = useRef<HTMLDivElement>(null);
	const contentAreaRef = useRef<HTMLDivElement>(null);
	const sidePanel = useSidePanel({ containerRef, sidePanelRef });

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ shareId }) });
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

	const isOwner = Boolean(session?.user?.id) && session?.user?.id === story?.userId;

	const editor = useStoryPageEditor({
		chatId: story?.chatId ?? '',
		storySlug: story?.slug ?? '',
		storyTitle: story?.title ?? '',
		latestCode: story?.code ?? '',
		isReadonlyMode: !isOwner,
	});

	if (isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	const isEditing = isOwner && Boolean(story.chatId) && editor.viewMode !== 'preview';

	const header =
		isOwner && story.chatId ? (
			<SharedStoryOwnerHeader
				title={story.title}
				authorName={story.authorName}
				storyId={story.storyId}
				chatId={story.chatId}
				storySlug={story.slug}
				onOpenChat={() =>
					navigate({
						to: '/$chatId',
						params: { chatId: story.chatId! },
						state: { openStorySlug: story.slug },
					})
				}
				viewModeControls={{
					viewMode: editor.viewMode,
					onViewModeChange: editor.setViewMode,
					canEdit: true,
					isCodeDirty: editor.isCodeDirty,
					isCodeValid: editor.isCodeValid,
					onSave: editor.handleSave,
				}}
				versionControls={{
					currentVersion: editor.versionNav.currentVersion,
					totalVersions: editor.versionNav.totalVersions,
					isViewingLatest: editor.versionNav.isViewingLatest,
					onPrevious: editor.versionNav.goToPrevious,
					onNext: editor.versionNav.goToNext,
					onRestore: editor.handleRestore,
				}}
			/>
		) : (
			<StoryPageHeader
				title={story.title}
				authorName={story.authorName}
				openChatLabel='Discuss story'
				onOpenChat={isViewer ? undefined : () => forkMutation.mutate({ shareId, type: 'story' })}
				isOpeningChat={forkMutation.isPending}
				live={
					story.isLive
						? {
								isLive: true,
								isRefreshing: refreshMutation.isPending,
								onRefresh: () => refreshMutation.mutate({ shareId }),
							}
						: undefined
				}
				download={{ chatId: story.chatId!, storySlug: story.slug, shareId, isOwner: false }}
			/>
		);

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
			<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0' ref={containerRef}>
				{header}

				<SelectionProvider key={shareId} persistenceConfig={{ shareId, contentType: 'story' }}>
					{!isViewer && !isEditing && <ForkBubble shareId={shareId} contentType='story' />}
					{!isViewer && !isEditing && <SelectionChatPanel contentAreaRef={contentAreaRef} />}
					<div className='flex flex-1 min-h-0 min-w-0'>
						<div ref={contentAreaRef} className='flex flex-col flex-1 min-w-0 min-h-0'>
							<StoryPageBody
								code={editor.code}
								editor={editor}
								queryData={story.queryData as QueryDataMap | null}
								preview={
									<SharedStoryContent
										code={editor.code}
										queryData={story.queryData as QueryDataMap | null}
										chatId={story.chatId!}
										cacheSchedule={story.cacheSchedule}
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

interface SharedStoryOwnerHeaderProps {
	title: string;
	authorName: string;
	storyId: string | null;
	chatId: string;
	storySlug: string;
	onOpenChat: () => void;
	viewModeControls: StoryPageHeaderProps['viewModeControls'];
	versionControls: StoryPageHeaderProps['versionControls'];
}

function SharedStoryOwnerHeader({
	title,
	authorName,
	storyId,
	chatId,
	storySlug,
	onOpenChat,
	viewModeControls,
	versionControls,
}: SharedStoryOwnerHeaderProps) {
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);

	const {
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	} = useStoryViewerLiveSettings({ chatId, storySlug });

	return (
		<>
			<StoryPageHeader
				title={title}
				authorName={authorName}
				onOpenChat={onOpenChat}
				live={{
					isLive,
					isRefreshing,
					onRefresh: () => handleRefreshData(),
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ chatId, storySlug, isOwner: true }}
				storyId={storyId}
				isShared
				onShare={() => setIsShareDialogOpen(true)}
				viewModeControls={viewModeControls}
				versionControls={versionControls}
			/>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				isLive={isLive}
				isLiveTextDynamic={isLiveTextDynamic}
				cacheSchedule={cacheSchedule}
				cacheScheduleDescription={cacheScheduleDescription}
				isUpdating={isUpdating}
				onSaveSettings={handleSaveSettings}
			/>

			<ShareStoryDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				chatId={chatId}
				storySlug={storySlug}
			/>
		</>
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
