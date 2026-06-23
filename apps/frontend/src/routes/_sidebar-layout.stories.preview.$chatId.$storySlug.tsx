import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArchiveRestoreIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { QueryDataMap } from '@/components/story-embeds';
import type { SelectionData } from '@/components/highlight-bubble';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { HighlightBubble } from '@/components/highlight-bubble';
import { SegmentList } from '@/components/story-rendering';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { StoryContentLoading } from '@/components/side-panel/story-content-loading';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { StoryPageHeader } from '@/components/story-page-header';
import { SelectionProvider } from '@/contexts/text-selection';
import { StoryChartEditProvider } from '@/contexts/story-chart-edit';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';

export const Route = createFileRoute('/_sidebar-layout/stories/preview/$chatId/$storySlug')({
	component: StoryPreviewPage,
	pendingComponent: StoryContentLoading,
});

function StoryPreviewPage() {
	const { chatId, storySlug } = Route.useParams();
	const { data: story } = useSuspenseQuery(trpc.story.getLatest.queryOptions({ chatId, storySlug }));
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { running: isChatRunning } = useChatActivity(chatId);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

	const {
		storyId,
		isLive,
		isLiveTextDynamic,
		cacheSchedule: liveCacheSchedule,
		cacheScheduleDescription,
		isUpdating,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	} = useStoryViewerLiveSettings({ chatId, storySlug });

	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }));
	const isShared = Boolean(shareQuery.data?.shareId);

	useTrackViewDuration({ assetType: 'story', storyId, chatId, versionNumber: story.version });

	const editor = useStoryPageEditor({
		chatId,
		storySlug,
		storyTitle: story.title,
		latestCode: story.code,
		isAgentRunning: isChatRunning,
	});

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			chatPendingCitationStore.set({ chatId, storySlug, ...data });
			navigate({ to: '/$chatId', params: { chatId } });
		},
		[navigate, chatId, storySlug],
	);

	const handleOpenChat = useCallback(() => {
		navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: storySlug } });
	}, [navigate, chatId, storySlug]);

	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }) });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	const canEditCharts = !story.archivedAt;

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={story.title}
				onOpenChat={handleOpenChat}
				live={{
					isLive,
					isRefreshing,
					onRefresh: () => handleRefreshData(),
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ chatId, storySlug, isOwner: true }}
				storyId={storyId}
				isShared={isShared}
				onShare={() => setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{
					viewMode: editor.viewMode,
					onViewModeChange: editor.setViewMode,
					canEdit: canEditCharts,
					isAgentRunning: isChatRunning,
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

			<StoryPageBody
				code={editor.code}
				editor={editor}
				queryData={story.queryData as QueryDataMap | null}
				preview={
					<SelectionProvider key={storySlug}>
						<HighlightBubble onAsk={handleSelectionAsk} disabled={isChatRunning} />
						{renderWithChartEditProvider(
							canEditCharts && editor.versionNav.isViewingLatest,
							{ chatId, storySlug, storyTitle: story.title, storyCode: editor.code },
							<PreviewContent
								code={editor.code}
								queryData={story.queryData as QueryDataMap | null}
								chatId={chatId}
								cacheSchedule={story.cacheSchedule}
							/>,
						)}
					</SelectionProvider>
				}
			/>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				isLive={isLive}
				isLiveTextDynamic={isLiveTextDynamic}
				cacheSchedule={liveCacheSchedule}
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

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId ?? undefined}
				chatId={chatId}
			/>
		</div>
	);
}

function renderWithChartEditProvider(
	enabled: boolean,
	params: { chatId: string; storySlug: string; storyTitle: string; storyCode: string },
	children: React.ReactNode,
) {
	if (!enabled) {
		return children;
	}

	return (
		<StoryChartEditProvider
			chatId={params.chatId}
			storySlug={params.storySlug}
			storyTitle={params.storyTitle}
			storyCode={params.storyCode}
		>
			{children}
		</StoryChartEditProvider>
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
