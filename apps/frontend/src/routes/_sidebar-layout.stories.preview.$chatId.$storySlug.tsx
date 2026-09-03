import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArchiveRestoreIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { QueryDataMap } from '@/components/story-embeds';
import type { SelectionData } from '@/components/highlight-bubble';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { StoryContentLoading } from '@/components/side-panel/story-content-loading';
import { StoryRouteError } from '@/components/story-access-error';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { StoryPageHeader } from '@/components/story-page-header';
import { SelectionProvider } from '@/contexts/text-selection';
import { StoryChartEditProvider } from '@/contexts/story-chart-edit';
import { StoryMapEditProvider } from '@/contexts/story-map-edit';
import { StoryTableEditProvider } from '@/contexts/story-table-edit';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';

export const Route = createFileRoute('/_sidebar-layout/stories/preview/$chatId/$storySlug')({
	component: StoryPreviewPage,
	pendingComponent: StoryContentLoading,
	errorComponent: StoryRouteError,
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
	const { queryData, isPending: isQueryDataPending } = useStoryVersionQueryData({
		chatId,
		storySlug,
		versionNumber: editor.versionNav.storedVersionNumber,
		isViewingLatest: editor.versionNav.isViewingLatest,
		latestQueryData: story.queryData as QueryDataMap | null,
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
					cachedAt: story.cachedAt,
					lastRefreshFailure: story.lastRefreshFailure,
					isRefreshing,
					onRefresh: () => handleRefreshData(),
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ chatId, storySlug, isOwner: true }}
				storyId={storyId}
				canRename
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
				editor={editor}
				queryData={queryData}
				preview={
					<SelectionProvider key={storySlug}>
						<HighlightBubble onAsk={handleSelectionAsk} disabled={isChatRunning} />
						{renderWithChartEditProvider(
							canEditCharts && editor.versionNav.isViewingLatest && !isChatRunning,
							{ chatId, storySlug, storyTitle: story.title, storyCode: editor.code },
							<PreviewContent
								code={editor.code}
								queryData={queryData}
								chatId={chatId}
								storySlug={storySlug}
								cacheSchedule={story.cacheSchedule}
								filtersEnabled={editor.versionNav.isViewingLatest && !editor.isCodeDirty}
								isDataPending={isQueryDataPending}
								isViewingLatest={editor.versionNav.isViewingLatest}
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
			<StoryTableEditProvider
				chatId={params.chatId}
				storySlug={params.storySlug}
				storyTitle={params.storyTitle}
				storyCode={params.storyCode}
			>
				<StoryMapEditProvider
					chatId={params.chatId}
					storySlug={params.storySlug}
					storyTitle={params.storyTitle}
					storyCode={params.storyCode}
				>
					{children}
				</StoryMapEditProvider>
			</StoryTableEditProvider>
		</StoryChartEditProvider>
	);
}

function PreviewContent({
	code,
	queryData,
	chatId,
	storySlug,
	cacheSchedule,
	filtersEnabled,
	isDataPending,
	isViewingLatest,
}: {
	code: string;
	queryData: QueryDataMap | null;
	chatId: string;
	storySlug: string;
	cacheSchedule?: string | null;
	filtersEnabled: boolean;
	isDataPending: boolean;
	isViewingLatest: boolean;
}) {
	const isNoCacheMode = cacheSchedule === 'no-cache';
	const useLiveUnfiltered = isViewingLatest && isNoCacheMode;
	const filterApi = useMemo(
		() => (filtersEnabled ? { kind: 'owned' as const, chatId, storySlug } : null),
		[chatId, filtersEnabled, storySlug],
	);

	const noCacheQuery = useMemo(
		() => (useLiveUnfiltered ? { queryOptions: trpc.story.getLiveQueryData.queryOptions, chatId } : undefined),
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
