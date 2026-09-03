import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { SelectionData } from '@/components/highlight-bubble';
import type { QueryDataMap } from '@/components/story-embeds';
import type { StoryRefreshFailure } from '@/components/story-page-header';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryAccessError } from '@/components/story-access-error';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { StoryPageHeader } from '@/components/story-page-header';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/standalone/$storyId')({
	component: StandaloneStoryPage,
});

function StandaloneStoryPage() {
	const { storyId } = Route.useParams();
	const navigate = useNavigate();
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const queryClient = useQueryClient();

	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber: story?.version });

	const openStandaloneMutation = useMutation(
		trpc.chatFork.openStandalone.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: story?.slug } });
			},
		}),
	);

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			if (!story?.chatId) {
				return;
			}
			chatPendingCitationStore.set({ chatId: story.chatId, storySlug: story.slug, ...data });
			navigate({ to: '/$chatId', params: { chatId: story.chatId } });
		},
		[navigate, story?.chatId, story?.slug],
	);

	const handleOpenChat = useCallback(() => {
		if (!story) {
			return;
		}
		if (story.chatId) {
			navigate({ to: '/$chatId', params: { chatId: story.chatId }, state: { openStorySlug: story.slug } });
		} else {
			openStandaloneMutation.mutate({ storyId });
		}
	}, [story, storyId, navigate, openStandaloneMutation]);

	if (storyQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (storyQuery.isError || !story) {
		return <StoryAccessError error={storyQuery.error} onRetry={() => storyQuery.refetch()} />;
	}

	if (story.chatId) {
		return (
			<StandaloneEditableStory
				title={story.title}
				code={story.code}
				storyId={storyId}
				chatId={story.chatId}
				storySlug={story.slug}
				queryData={story.queryData as QueryDataMap | null}
				cachedAt={story.cachedAt}
				lastRefreshFailure={story.lastRefreshFailure}
				onOpenChat={handleOpenChat}
				isOpeningChat={openStandaloneMutation.isPending}
			/>
		);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={story.title}
				onOpenChat={handleOpenChat}
				isOpeningChat={openStandaloneMutation.isPending}
				download={{ storyId, isOwner: true }}
				storyId={storyId}
				canRename
				live={
					story.isLive
						? {
								isLive: true,
								cachedAt: story.cachedAt,
								lastRefreshFailure: story.lastRefreshFailure,
							}
						: undefined
				}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
			/>
			<SelectionProvider key={storyId}>
				<HighlightBubble onAsk={handleSelectionAsk} disabled />
				<StandaloneStoryContent
					code={story.code}
					queryData={story.queryData as QueryDataMap | null}
					chatId={story.chatId}
					storySlug={story.slug}
				/>
			</SelectionProvider>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>
		</div>
	);
}

interface StandaloneEditableStoryProps {
	title: string;
	code: string;
	storyId: string;
	chatId: string;
	storySlug: string;
	queryData: QueryDataMap | null;
	cachedAt?: string | Date | null;
	lastRefreshFailure?: StoryRefreshFailure | null;
	onOpenChat: () => void;
	isOpeningChat: boolean;
}

function StandaloneEditableStory({
	title,
	code,
	storyId,
	chatId,
	storySlug,
	queryData,
	cachedAt,
	lastRefreshFailure,
	onOpenChat,
	isOpeningChat,
}: StandaloneEditableStoryProps) {
	const navigate = useNavigate();
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

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

	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }));
	const isShared = Boolean(shareQuery.data?.shareId);

	const editor = useStoryPageEditor({ chatId, storySlug, storyTitle: title, latestCode: code });
	const { queryData: versionQueryData, isPending: isQueryDataPending } = useStoryVersionQueryData({
		chatId,
		storySlug,
		versionNumber: editor.versionNav.storedVersionNumber,
		isViewingLatest: editor.versionNav.isViewingLatest,
		latestQueryData: queryData,
	});

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			chatPendingCitationStore.set({ chatId, storySlug, ...data });
			navigate({ to: '/$chatId', params: { chatId } });
		},
		[navigate, chatId, storySlug],
	);

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={title}
				onOpenChat={onOpenChat}
				isOpeningChat={isOpeningChat}
				live={{
					isLive,
					cachedAt,
					lastRefreshFailure,
					isRefreshing,
					onRefresh: () => handleRefreshData(),
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ storyId, isOwner: true }}
				storyId={storyId}
				canRename
				isShared={isShared}
				onShare={() => setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{
					viewMode: editor.viewMode,
					onViewModeChange: editor.setViewMode,
					canEdit: true,
					isCodeDirty: editor.isCodeDirty,
					isCodeValid: editor.isCodeValid,
					onSave: editor.handleSave,
					onCancel: editor.handleCancel,
					isSaving: editor.isSaving,
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

			<StoryPageBody
				editor={editor}
				queryData={versionQueryData}
				preview={
					<SelectionProvider key={storySlug}>
						<HighlightBubble onAsk={handleSelectionAsk} disabled={false} />
						<StandaloneStoryContent
							code={editor.code}
							queryData={versionQueryData}
							chatId={chatId}
							storySlug={storySlug}
							filtersEnabled={editor.versionNav.isViewingLatest && !editor.isCodeDirty}
							isDataPending={isQueryDataPending}
						/>
					</SelectionProvider>
				}
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

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>
		</div>
	);
}

function StandaloneStoryContent({
	code,
	queryData,
	chatId,
	storySlug,
	filtersEnabled = true,
	isDataPending = false,
}: {
	code: string;
	queryData: QueryDataMap | null;
	chatId?: string | null;
	storySlug?: string;
	filtersEnabled?: boolean;
	isDataPending?: boolean;
}) {
	const filterApi = filtersEnabled && chatId && storySlug ? { kind: 'owned' as const, chatId, storySlug } : null;

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
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending],
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
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending],
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
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
				allowExpand
			/>
		),
		[isDataPending],
	);

	return (
		<StoryTabbedContent
			code={code}
			baselineQueryData={queryData}
			filterApi={filterApi}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
