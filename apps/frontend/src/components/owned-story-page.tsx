import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ArchiveRestoreIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { StoryElementAsk } from '@nao/shared/story-app';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { LiveQueryConfig, QueryDataMap } from '@/components/story-embeds';
import type { CodeSelection } from '@/stores/ask-bar';
import type { SelectionData } from '@/components/highlight-bubble';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryElementPicker } from '@/components/story-element-picker';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { useStoryThemeForCurrentMode } from '@/components/story-theme-provider';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { STORY_ASK_BAR_INSET_STYLE, StoryAskBar } from '@/components/story-ask-bar';
import { StoryPageHeader } from '@/components/story-page-header';
import { SelectionProvider } from '@/contexts/text-selection';
import { StoryChartEditProvider } from '@/contexts/story-chart-edit';
import { StoryMapEditProvider } from '@/contexts/story-map-edit';
import { StoryTableEditProvider } from '@/contexts/story-table-edit';
import { requestAskAboutCode, requestAskAboutElement, requestAskAboutSelection } from '@/stores/ask-bar';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { useCitedElementFollower } from '@/hooks/use-cited-element-follower';
import { useCodeRevealFollower } from '@/hooks/use-code-reveal';
import { useRetryStaleStoryRefresh } from '@/hooks/use-retry-stale-story-refresh';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';

export function OwnedStoryPage({ chatId, storySlug }: { chatId: string; storySlug: string }) {
	const { data: story } = useSuspenseQuery(trpc.story.getLatest.queryOptions({ chatId, storySlug }));
	const queryClient = useQueryClient();
	const { running: isChatRunning } = useChatActivity(chatId);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();

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
	useRetryStaleStoryRefresh({
		storyKey: `${chatId}/${storySlug}`,
		needsRefresh: story.needsRefresh,
		isRefreshing,
		refresh: handleRefreshData,
	});

	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }));
	const isShared = shareQuery.data?.isShared === true;

	useTrackViewDuration({ assetType: 'story', storyId, chatId, versionNumber: story.version });

	const editor = useStoryPageEditor({
		chatId,
		storySlug,
		storyTitle: story.title,
		latestCode: story.code,
		isAgentRunning: isChatRunning,
	});
	useCodeRevealFollower(storySlug, () => editor.setViewMode('code'));
	useCitedElementFollower(storySlug, () => {
		if (editor.viewMode === 'code') {
			editor.setViewMode('preview');
		}
	});
	const { queryData, isPending: isQueryDataPending } = useStoryVersionQueryData({
		chatId,
		storySlug,
		versionNumber: editor.versionNav.storedVersionNumber,
		isViewingLatest: editor.versionNav.isViewingLatest,
		latestQueryData: story.queryData as QueryDataMap | null,
	});
	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }) });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	const isArchived = Boolean(story.archivedAt);
	const canEditCharts = !isArchived;
	const storyTheme = useStoryThemeForCurrentMode(story.theme);
	const showAskBar = Boolean(storyId) && !isArchived;
	const isAskInputHidden = editor.viewMode === 'edit';
	const canSelectElements = showAskBar && editor.viewMode === 'preview';
	const askAboutElement = useCallback((ask: StoryElementAsk) => requestAskAboutElement(ask, storySlug), [storySlug]);
	const askAboutSelection = useCallback(
		(selection: SelectionData) => requestAskAboutSelection(selection, storySlug),
		[storySlug],
	);
	const askAboutCode = useCallback(
		(selection: CodeSelection) => requestAskAboutCode(selection, { storySlug }),
		[storySlug],
	);

	return (
		<div
			className='relative flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'
			style={showAskBar && !isAskInputHidden ? STORY_ASK_BAR_INSET_STYLE : undefined}
		>
			<StoryPageHeader
				title={story.title}
				storyChat={{ storyId, isOwner: true, canChat: !isArchived }}
				canDuplicate={!isArchived}
				live={{
					isLive,
					cachedAt: story.cachedAt,
					lastRefreshFailure: story.lastRefreshFailure,
					isRefreshing,
					isUpdating,
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
					versionDates: editor.versionNav.versionDates,
					versionDate: editor.versionNav.versionDate,
					isViewingLatest: editor.versionNav.isViewingLatest,
					onSelectVersion: editor.versionNav.goToVersion,
					onRestore: editor.handleRestore,
				}}
				elementSelection={
					canSelectElements
						? { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements }
						: undefined
				}
			/>

			{story.archivedAt && (
				<div className='flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 md:px-6'>
					<span className='text-xs text-muted-foreground'>This story has been archived.</span>
					<Button
						variant='outline'
						size='sm'
						className='gap-1.5 shrink-0 rounded-full'
						onClick={() => unarchiveMutation.mutate({ chatId, storySlug })}
						disabled={unarchiveMutation.isPending}
					>
						<ArchiveRestoreIcon className='size-3' />
						<span>Unarchive</span>
					</Button>
				</div>
			)}

			<div className='relative flex min-h-0 flex-1 flex-col'>
				<SelectionProvider resetKey={storySlug}>
					<StoryPageBody
						editor={editor}
						queryData={queryData}
						theme={storyTheme}
						onAskAboutCode={showAskBar ? askAboutCode : undefined}
						preview={
							<>
								<HighlightBubble onAsk={askAboutSelection} disabled={isChatRunning} />
								<StoryElementPicker
									isPicking={canSelectElements && isSelectingElements}
									storySlug={storySlug}
									onPick={askAboutElement}
								>
									{renderWithChartEditProvider(
										canEditCharts && editor.versionNav.isViewingLatest && !isChatRunning,
										{ chatId, storySlug, storyTitle: story.title, storyCode: editor.code },
										<PreviewContent
											code={editor.code}
											queryData={queryData}
											theme={storyTheme}
											chatId={chatId}
											storySlug={storySlug}
											cacheSchedule={story.cacheSchedule}
											filtersEnabled={editor.versionNav.isViewingLatest && !editor.isCodeDirty}
											isDataPending={isQueryDataPending}
											isViewingLatest={editor.versionNav.isViewingLatest}
										/>,
									)}
								</StoryElementPicker>
							</>
						}
					/>

					{showAskBar && storyId && (
						<StoryAskBar storyId={storyId} isOwner isInputHidden={isAskInputHidden} />
					)}
				</SelectionProvider>
			</div>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				chatId={chatId}
				storySlug={storySlug}
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
	theme,
	chatId,
	storySlug,
	cacheSchedule,
	filtersEnabled,
	isDataPending,
	isViewingLatest,
}: {
	code: string;
	queryData: QueryDataMap | null;
	theme: ReturnType<typeof useStoryThemeForCurrentMode>;
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

	const noCacheQuery = useMemo<LiveQueryConfig | undefined>(
		() =>
			useLiveUnfiltered
				? { queryOptions: (queryId) => trpc.story.getLiveQueryData.queryOptions({ chatId, queryId }) }
				: undefined,
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
			storySlug={storySlug}
			baselineQueryData={queryData}
			filterApi={filterApi}
			theme={theme}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
