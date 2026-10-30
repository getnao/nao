import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { DownloadFormat, StoryBlockReference } from '@nao/shared/types';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest } from '@nao/shared/story-app';
import type { StoryBlockEditTarget, StoryTableFormatEditTarget } from '@/stores/story-block-edit';

import type { CustomStoryDataSource, CustomStoryFileSource } from '@/components/custom-story/story-data-options';
import type { CustomStoryViewMode } from '@/components/custom-story/custom-story-view-mode';
import type { StoryPageHeaderProps } from '@/components/story-page-header';
import { STORY_ASK_BAR_INSET, StoryAskBar } from '@/components/story-ask-bar';
import {
	CustomStoryBlockEditDialog,
	CustomStoryTableFormatDialog,
} from '@/components/custom-story/custom-story-block-edit';
import { ActionErrorBanner, CustomStoryBody } from '@/components/custom-story/custom-story-body';
import { CustomStoryFiles } from '@/components/custom-story/custom-story-files';
import { CustomStoryViewLayers } from '@/components/custom-story/custom-story-view-mode';
import { useCustomStory } from '@/components/custom-story/use-custom-story';
import { useCustomStoryDownload } from '@/components/custom-story/use-custom-story-download';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { SharedStoryHeader } from '@/components/shared-story-header';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { useStoryViewerSharing } from '@/components/side-panel/hooks/use-story-viewer-sharing';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { ArchivedBanner } from '@/components/side-panel/story-archived-banner';
import { StoryPageHeader } from '@/components/story-page-header';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useOpenStandaloneStoryInChat } from '@/hooks/use-open-standalone-story-in-chat';
import { useRetryStaleStoryRefresh } from '@/hooks/use-retry-stale-story-refresh';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc, trpcClient } from '@/main';
import { requestAsk } from '@/stores/ask-bar';

interface CustomStoryPreviewPageProps {
	chatId: string;
	storySlug: string;
	authorName?: string;
}

/** Full-page view of a custom story for its owner, with the same header as a classic story's page. */
export function CustomStoryPreviewPage({ chatId, storySlug, authorName }: CustomStoryPreviewPageProps) {
	const story = useCustomStory(chatId, storySlug);
	const { customStoryCreationEnabled } = useEffectiveUserGroupFeatures();
	const { content } = story;
	const storyId = story.versionsQuery.data?.id ?? content?.storyId ?? null;
	const sharing = useStoryViewerSharing({ chatId, storySlug });
	const live = useStoryViewerLiveSettings({ chatId, storySlug });
	useRetryStaleStoryRefresh({
		storyKey: `${chatId}/${storySlug}`,
		needsRefresh: content?.needsRefresh ?? false,
		isRefreshing: live.isRefreshing,
		refresh: live.handleRefreshData,
	});
	const [viewMode, setViewMode] = useState<CustomStoryViewMode>('app');
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<StoryBlockEditTarget | null>(null);
	const [tableFormatTarget, setTableFormatTarget] = useState<StoryTableFormatEditTarget | null>(null);
	const canEditBlocks = story.isViewingLatest && !story.isAgentRunning && !story.isArchived;

	const handleEditBlock = useCallback(
		(payload: StoryBlockEditPayload) => {
			if (content) {
				setEditTarget({ chatId, storySlug, versionNumber: content.version.number, payload });
			}
		},
		[chatId, content, storySlug],
	);
	const handleEditTableFormat = useCallback(
		(request: StoryTableFormatEditRequest) => {
			if (content) {
				setTableFormatTarget({ chatId, storySlug, versionNumber: content.version.number, request });
			}
		},
		[chatId, content, storySlug],
	);
	const handleAskBlock = useCallback((block: StoryBlockReference) => {
		requestAsk({ chatId: null, selection: { text: block.title ?? '', block } });
	}, []);

	useTrackViewDuration({ assetType: 'story', chatId, storyId, versionNumber: story.viewedVersion ?? undefined });
	const showAskBar = Boolean(storyId) && !story.isArchived;
	const isAskInputHidden = viewMode !== 'app';

	return (
		<div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<StoryPageHeader
				title={content?.title ?? story.versionsQuery.data?.title ?? storySlug}
				authorName={authorName}
				storyChat={{ storyId, isOwner: true, canChat: !story.isArchived }}
				canDuplicate={!story.isArchived && customStoryCreationEnabled}
				viewedVersionNumber={story.viewedVersion ?? undefined}
				live={{
					isLive: live.isLive,
					cachedAt: content?.cachedAt,
					lastRefreshFailure: content?.lastRefreshFailure,
					isRefreshing: live.isRefreshing,
					isUpdating: live.isUpdating,
					onRefresh: live.handleRefreshData,
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ chatId, storySlug, isOwner: true, onDownload: story.download }}
				storyId={storyId}
				canRename
				isShared={sharing.isShared}
				onShare={() => sharing.setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{ viewMode, onViewModeChange: setViewMode }}
				versionControls={{
					currentVersion: story.currentVersionIndex,
					versionDates: story.versionDates,
					versionDate: story.viewedVersionDate,
					isViewingLatest: story.isViewingLatest,
					onSelectVersion: story.goToVersion,
					onRestore: story.restore,
				}}
			/>

			{story.isArchived && <ArchivedBanner chatId={chatId} storySlug={storySlug} />}
			{story.restoreError && <ActionErrorBanner message={story.restoreError.message} />}

			<div className='relative flex min-h-0 flex-1 flex-col'>
				<CustomStoryViewLayers
					viewMode={viewMode}
					app={
						<CustomStoryBody
							bottomInset={showAskBar && !isAskInputHidden ? STORY_ASK_BAR_INSET : undefined}
							dataSource={story.dataSource}
							content={content}
							isLoading={story.isLoading}
							error={story.error}
							hasPublishedVersion={story.hasPublishedVersion}
							editable={canEditBlocks && viewMode === 'app'}
							onEditBlock={handleEditBlock}
							onEditTableFormat={handleEditTableFormat}
							onAskBlock={handleAskBlock}
						/>
					}
					files={
						content && (
							<CustomStoryFiles
								key={content.version.id}
								source={story.dataSource}
								versionNumber={content.version.number}
								files={content.files}
								editable={canEditBlocks && customStoryCreationEnabled}
							/>
						)
					}
				/>
				{showAskBar && storyId && <StoryAskBar storyId={storyId} isOwner isInputHidden={isAskInputHidden} />}
			</div>

			<CustomStoryBlockEditDialog
				target={canEditBlocks ? editTarget : null}
				onClose={() => setEditTarget(null)}
			/>
			<CustomStoryTableFormatDialog
				target={canEditBlocks ? tableFormatTarget : null}
				onClose={() => setTableFormatTarget(null)}
			/>
			<ShareStoryDialog
				open={sharing.isShareDialogOpen}
				onOpenChange={sharing.setIsShareDialogOpen}
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
			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				chatId={chatId}
				storySlug={storySlug}
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

/** A custom story of the user outside any chat: it renders from the rows saved with it and is edited in a new chat. */
export function StandaloneCustomStoryPage({ storyId }: { storyId: string }) {
	const storyQuery = useQuery(trpc.standaloneCustomStory.listVersions.queryOptions({ storyId }));
	const contentQuery = useQuery(trpc.standaloneCustomStory.getVersion.queryOptions({ storyId }));
	const story = storyQuery.data;
	const content = contentQuery.data;
	const versionNumber = content?.version.number;
	const storySlug = story?.slug ?? '';
	const dataSource = useMemo<CustomStoryFileSource>(
		() => ({ kind: 'standalone', storyId, storySlug, versionNumber }),
		[storyId, storySlug, versionNumber],
	);
	const openInChat = useOpenStandaloneStoryInChat(storyId, story?.slug);
	const { customStoryCreationEnabled } = useEffectiveUserGroupFeatures();
	const [viewMode, setViewMode] = useState<CustomStoryViewMode>('app');
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const renderExport = useCallback(
		(format: DownloadFormat, html: string) =>
			trpcClient.standaloneCustomStory.download.mutate({ storyId, format, html, versionNumber }),
		[storyId, versionNumber],
	);
	const download = useCustomStoryDownload(content, dataSource, renderExport);
	const handleAskBlock = useCallback((block: StoryBlockReference) => {
		requestAsk({ chatId: null, selection: { text: block.title ?? '', block } });
	}, []);

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber });
	const isArchived = Boolean(story?.archivedAt);
	const isAskInputHidden = viewMode !== 'app';

	return (
		<div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<StoryPageHeader
				title={content?.title ?? story?.title ?? ''}
				storyChat={{
					storyId,
					isOwner: true,
					canChat: !isArchived,
					onOpenInChat: openInChat.open,
					isOpeningInChat: openInChat.isOpening,
				}}
				canDuplicate={!isArchived && customStoryCreationEnabled}
				download={{ storyId, isOwner: true, onDownload: download }}
				storyId={storyId}
				canRename
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{ viewMode, onViewModeChange: setViewMode }}
			/>

			<div className='relative flex min-h-0 flex-1 flex-col'>
				<CustomStoryViewLayers
					viewMode={viewMode}
					app={
						<CustomStoryBody
							bottomInset={isArchived || isAskInputHidden ? undefined : STORY_ASK_BAR_INSET}
							dataSource={dataSource}
							content={content}
							isLoading={contentQuery.isLoading}
							error={contentQuery.error}
							hasPublishedVersion
							onAskBlock={handleAskBlock}
						/>
					}
					files={
						content && (
							<CustomStoryFiles
								key={content.version.id}
								source={dataSource}
								versionNumber={content.version.number}
								files={content.files}
							/>
						)
					}
				/>
				{!isArchived && <StoryAskBar storyId={storyId} isOwner isInputHidden={isAskInputHidden} />}
			</div>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>
		</div>
	);
}

interface SharedCustomStoryPageProps {
	storyId: string;
	title: string;
	authorName: string;
	isSignedIn: boolean;
	isLive: boolean;
	canRefresh: boolean;
	storyChatHeader?: Pick<StoryPageHeaderProps, 'storyChat' | 'canDuplicate'>;
}

/** A custom story opened from a share link: data comes through the share, limited to the queries the story uses. */
export function SharedCustomStoryPage({
	storyId,
	title,
	authorName,
	isSignedIn,
	isLive,
	canRefresh,
	storyChatHeader,
}: SharedCustomStoryPageProps) {
	const queryClient = useQueryClient();
	const contentQuery = useQuery(trpc.storyShare.getCustomVersion.queryOptions({ storyId }));
	const content = contentQuery.data;
	const versionNumber = content?.version.number;
	const dataSource = useMemo<CustomStoryDataSource>(
		() => ({ kind: 'share', storyId, versionNumber }),
		[storyId, versionNumber],
	);

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSettled: () =>
				Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ storyId }) }),
					queryClient.invalidateQueries({ queryKey: trpc.storyShare.getCustomVersion.queryKey({ storyId }) }),
					queryClient.invalidateQueries({
						queryKey: trpc.storyShare.getCustomStoryQueryData.queryKey({ storyId }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.storyShare.getCustomStoryNarratives.queryKey({ storyId }),
					}),
				]),
		}),
	);
	const renderExport = useCallback(
		(format: DownloadFormat, html: string) =>
			trpcClient.storyShare.downloadCustom.mutate({ storyId, format, html }),
		[storyId],
	);
	const download = useCustomStoryDownload(content, dataSource, renderExport);

	return (
		<div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<SharedStoryHeader
				title={content?.title ?? title}
				authorName={authorName}
				storyChatHeader={storyChatHeader}
				isLive={isLive}
				cachedAt={content?.cachedAt}
				lastRefreshFailure={content?.lastRefreshFailure}
				isRefreshing={refreshMutation.isPending}
				canRefresh={canRefresh}
				onRefresh={() => refreshMutation.mutate({ storyId })}
				storyId={isSignedIn ? storyId : null}
				download={{ shareSource: { type: 'story', storyId }, isOwner: false, onDownload: download }}
			/>
			<div className='relative flex min-h-0 flex-1 flex-col'>
				<CustomStoryBody
					bottomInset={storyChatHeader?.storyChat?.canChat ? STORY_ASK_BAR_INSET : undefined}
					dataSource={dataSource}
					content={content}
					isLoading={contentQuery.isLoading}
					error={contentQuery.error}
					hasPublishedVersion
				/>
				{storyChatHeader?.storyChat?.canChat && (
					<StoryAskBar storyId={storyId} isOwner={storyChatHeader.storyChat.isOwner} />
				)}
			</div>
		</div>
	);
}
