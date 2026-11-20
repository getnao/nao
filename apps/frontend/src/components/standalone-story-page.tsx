import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { NO_CACHE_SCHEDULE } from '@nao/shared';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

import type { LiveQueryConfig, QueryDataMap } from '@/components/story-embeds';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
import { ShareDialog } from '@/components/share-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { useStoryViewerSharing } from '@/components/side-panel/hooks/use-story-viewer-sharing';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { StoryAccessError } from '@/components/story-access-error';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryEditPresenceBanner } from '@/components/story-edit-presence-banner';
import { StoryElementPicker } from '@/components/story-element-picker';
import { StoryPageBody } from '@/components/story-page-body';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { useStoryThemeForCurrentMode } from '@/components/story-theme-provider';
import { STORY_ASK_BAR_INSET_STYLE, StoryAskBar } from '@/components/story-ask-bar';
import { StoryPageHeader } from '@/components/story-page-header';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { requestAskAboutCode, requestAskAboutElement, requestAskAboutSelection } from '@/stores/ask-bar';
import { useCitedElementFollower } from '@/hooks/use-cited-element-follower';
import { useCodeRevealFollower } from '@/hooks/use-code-reveal';
import { useOnAskRequest } from '@/hooks/use-on-ask-request';
import { useOpenStandaloneStoryInChat } from '@/hooks/use-open-standalone-story-in-chat';
import { useRetryStaleStoryRefresh } from '@/hooks/use-retry-stale-story-refresh';
import { useCloseWhenUneditable, useStoryEditSession } from '@/hooks/use-story-edit-session';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';
import { trpc } from '@/main';

type StandaloneStory = inferRouterOutputs<TrpcRouter>['story']['getStandalone'];

export function StandaloneStoryPage({ storyId }: { storyId: string }) {
	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;

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

	return <StandaloneStoryView storyId={storyId} story={story} />;
}

function StandaloneStoryView({ storyId, story }: { storyId: string; story: StandaloneStory }) {
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();
	const sharing = useStoryViewerSharing({ storyId });
	const live = useStoryViewerLiveSettings({ storyId });
	useRetryStaleStoryRefresh({
		storyKey: storyId,
		needsRefresh: story.needsRefresh,
		isRefreshing: live.isRefreshing,
		refresh: live.handleRefreshData,
	});
	const storyTheme = useStoryThemeForCurrentMode(story.theme);
	const openInChat = useOpenStandaloneStoryInChat(storyId, story.slug);

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber: story.version });

	const editor = useStoryPageEditor({
		chatId: '',
		storySlug: story.slug,
		storyTitle: story.title,
		latestCode: story.code,
		standaloneStoryId: storyId,
	});
	useCodeRevealFollower(story.slug, () => editor.setViewMode('code'));
	useCitedElementFollower(story.slug, () => {
		if (editor.viewMode === 'code') {
			editor.setViewMode('preview');
		}
	});
	const { queryData, isPending: isQueryDataPending } = useStoryVersionQueryData({
		chatId: '',
		storySlug: story.slug,
		versionNumber: editor.versionNav.storedVersionNumber,
		isViewingLatest: editor.versionNav.isViewingLatest,
		latestQueryData: story.queryData as QueryDataMap | null,
		standaloneStoryId: storyId,
	});

	const isArchived = Boolean(story.archivedAt);
	const isAskInputHidden = editor.viewMode === 'edit';
	const canSelectElements = !isArchived && editor.viewMode === 'preview';
	useOnAskRequest(() => {
		if (isAskInputHidden) {
			editor.setViewMode('preview');
		}
	});
	const presence = useStoryEditSession({
		target: { storyId },
		isEditing: editor.viewMode !== 'preview' || editor.isCodeDirty,
	});
	useCloseWhenUneditable(presence.canEdit || editor.isCodeDirty, () => {
		if (editor.viewMode !== 'preview') {
			editor.setViewMode('preview');
		}
	});

	return (
		<div
			className='relative flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'
			style={!isArchived && !isAskInputHidden ? STORY_ASK_BAR_INSET_STYLE : undefined}
		>
			<StoryPageHeader
				title={story.title}
				storyChat={{
					storyId,
					isOwner: true,
					canChat: !isArchived,
					onOpenInChat: story.chatId ? undefined : openInChat.open,
					isOpeningInChat: openInChat.isOpening,
				}}
				canDuplicate={!isArchived}
				viewedVersionNumber={editor.versionNav.storedVersionNumber || undefined}
				download={{ storyId, isOwner: true, versionNumber: editor.versionNav.storedVersionNumber || undefined }}
				storyId={storyId}
				canRename
				live={{
					isLive: live.isLive,
					cachedAt: story.cachedAt,
					lastRefreshFailure: story.lastRefreshFailure,
					isRefreshing: live.isRefreshing,
					isUpdating: live.isUpdating,
					onRefresh: live.handleRefreshData,
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				isShared={sharing.isShared}
				onShare={() => sharing.setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{
					viewMode: editor.viewMode,
					onViewModeChange: editor.setViewMode,
					canEdit: !isArchived,
					isCodeDirty: editor.isCodeDirty,
					isCodeValid: editor.isCodeValid,
					onSave: editor.handleSave,
					onCancel: editor.handleCancel,
					isSaving: editor.isSaving,
					saveError: editor.saveError,
					isEditLocked: !presence.canEdit,
				}}
				versionControls={{
					currentVersion: editor.versionNav.currentVersion,
					versions: editor.versionNav.versions,
					versionDate: editor.versionNav.versionDate,
					isViewingLatest: editor.versionNav.isViewingLatest,
					onSelectVersion: editor.versionNav.goToVersion,
					onRestore: editor.handleRestore,
					isRestoreDisabled: !presence.canEdit,
				}}
				elementSelection={
					isArchived
						? undefined
						: {
								isSelecting: canSelectElements && isSelectingElements,
								onSelectingChange: setIsSelectingElements,
								disabled: !canSelectElements,
							}
				}
			/>

			<StoryEditPresenceBanner presence={presence} />

			<div className='relative flex min-h-0 flex-1 flex-col'>
				<SelectionProvider key={storyId}>
					<StoryPageBody
						editor={editor}
						queryData={queryData}
						theme={storyTheme}
						isReadOnly={!presence.canEdit}
						onAskAboutCode={
							isArchived
								? undefined
								: (selection) => requestAskAboutCode(selection, { storySlug: story.slug })
						}
						preview={
							<>
								<HighlightBubble
									onAsk={(selection) => requestAskAboutSelection(selection, story.slug)}
									disabled={isArchived}
								/>
								<StoryElementPicker
									isPicking={canSelectElements && isSelectingElements}
									storySlug={story.slug}
									onPick={(ask) => requestAskAboutElement(ask, story.slug)}
								>
									<StandaloneStoryContent
										code={editor.code}
										queryData={queryData}
										theme={storyTheme}
										storyId={storyId}
										chatId={story.chatId}
										storySlug={story.slug}
										cacheSchedule={live.isLive ? live.cacheSchedule : null}
										isViewingLatest={editor.versionNav.isViewingLatest}
										filtersEnabled={editor.versionNav.isViewingLatest && !editor.isCodeDirty}
										isDataPending={isQueryDataPending}
									/>
								</StoryElementPicker>
							</>
						}
					/>

					{!isArchived && <StoryAskBar storyId={storyId} canEdit isInputHidden={isAskInputHidden} />}
				</SelectionProvider>
			</div>

			<ShareDialog
				open={sharing.isShareDialogOpen}
				onOpenChange={sharing.setIsShareDialogOpen}
				target={{ kind: 'standalone-story', storyId }}
			/>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				story={{ storyId }}
				isLive={live.isLive}
				isLiveTextDynamic={live.isLiveTextDynamic}
				cacheSchedule={live.cacheSchedule}
				cacheScheduleDescription={live.cacheScheduleDescription}
				isUpdating={live.isUpdating}
				onSaveSettings={live.handleSaveSettings}
			/>
		</div>
	);
}

function StandaloneStoryContent({
	code,
	queryData,
	theme,
	storyId,
	chatId,
	storySlug,
	cacheSchedule,
	isViewingLatest = true,
	filtersEnabled = true,
	isDataPending = false,
}: {
	code: string;
	queryData: QueryDataMap | null;
	theme: ReturnType<typeof useStoryThemeForCurrentMode>;
	storyId: string;
	chatId?: string | null;
	storySlug?: string;
	cacheSchedule?: string | null;
	isViewingLatest?: boolean;
	filtersEnabled?: boolean;
	isDataPending?: boolean;
}) {
	const useLiveUnfiltered = isViewingLatest && cacheSchedule === NO_CACHE_SCHEDULE;
	const filterApi = useMemo(() => {
		if (!filtersEnabled) {
			return null;
		}
		return chatId && storySlug
			? { kind: 'owned' as const, chatId, storySlug }
			: { kind: 'standalone' as const, storyId };
	}, [chatId, filtersEnabled, storyId, storySlug]);

	const noCacheQuery = useMemo<LiveQueryConfig | undefined>(() => {
		if (!useLiveUnfiltered) {
			return undefined;
		}
		return {
			queryOptions: (queryId) =>
				chatId && storySlug
					? trpc.story.getLiveQueryData.queryOptions({ chatId, queryId, storySlug })
					: trpc.story.getStandaloneLiveQueryData.queryOptions({ storyId, queryId }),
		};
	}, [chatId, storyId, storySlug, useLiveUnfiltered]);

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
			storyId={storyId}
			storySlug={storySlug}
			baselineQueryData={queryData}
			theme={theme}
			filterApi={filterApi}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
