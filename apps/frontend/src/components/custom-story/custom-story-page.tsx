import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { DownloadFormat } from '@nao/shared/types';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest, StoryElementCitation } from '@nao/shared/story-app';
import type { StoryBlockEditTarget, StoryTableFormatEditTarget } from '@/stores/story-block-edit';
import type { CodeSelection } from '@/stores/ask-bar';

import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
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
import { useCitedElementFollower } from '@/hooks/use-cited-element-follower';
import { useCodeRevealFollower } from '@/hooks/use-code-reveal';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useRetryStaleStoryRefresh } from '@/hooks/use-retry-stale-story-refresh';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';
import { trpc, trpcClient } from '@/main';
import { requestAsk, requestAskAboutCode } from '@/stores/ask-bar';

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
	useCodeRevealFollower(storySlug, () => setViewMode('files'));
	useCitedElementFollower(storySlug, () => setViewMode('app'));
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();
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
	const handleAsk = useCallback(
		({ text, block, intent }: StoryElementCitation) => {
			requestAsk({ chatId: null, selection: { text, block, intent, storySlug } });
		},
		[storySlug],
	);
	const handleAskAboutCode = useCallback(
		(filePath: string, selection: CodeSelection) => requestAskAboutCode(selection, { storySlug, filePath }),
		[storySlug],
	);

	useTrackViewDuration({ assetType: 'story', chatId, storyId, versionNumber: story.viewedVersion ?? undefined });
	const showAskBar = Boolean(storyId) && !story.isArchived;

	return (
		<div className='relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<StoryPageHeader
				title={content?.title ?? story.versionsQuery.data?.title ?? storySlug}
				authorName={authorName}
				storyChat={{ storyId, isOwner: true, canChat: !story.isArchived }}
				canDuplicate={!story.isArchived}
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
				elementSelection={
					showAskBar && viewMode === 'app'
						? { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements }
						: undefined
				}
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
							bottomInset={showAskBar ? STORY_ASK_BAR_INSET : undefined}
							dataSource={story.dataSource}
							content={content}
							isLoading={story.isLoading}
							error={story.error}
							hasPublishedVersion={story.hasPublishedVersion}
							editable={canEditBlocks && viewMode === 'app'}
							onEditBlock={handleEditBlock}
							onEditTableFormat={handleEditTableFormat}
							onAsk={showAskBar ? handleAsk : undefined}
							isSelectingElements={isSelectingElements && viewMode === 'app'}
						/>
					}
					files={
						content && (
							<div
								className='h-full'
								style={showAskBar ? { paddingBottom: STORY_ASK_BAR_INSET } : undefined}
							>
								<CustomStoryFiles
									key={content.version.id}
									source={story.dataSource}
									versionNumber={content.version.number}
									files={content.files}
									editable={canEditBlocks && customStoryCreationEnabled}
									onAskAboutCode={showAskBar ? handleAskAboutCode : undefined}
								/>
							</div>
						)
					}
				/>
				{showAskBar && storyId && <StoryAskBar storyId={storyId} isOwner />}
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
	const canAsk = Boolean(storyChatHeader?.storyChat?.canChat);
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();

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
				elementSelection={
					canAsk ? { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements } : undefined
				}
			/>
			<div className='relative flex min-h-0 flex-1 flex-col'>
				<CustomStoryBody
					bottomInset={canAsk ? STORY_ASK_BAR_INSET : undefined}
					dataSource={dataSource}
					content={content}
					isLoading={contentQuery.isLoading}
					error={contentQuery.error}
					hasPublishedVersion
					onAsk={canAsk ? askAboutSharedStoryElement : undefined}
					isSelectingElements={canAsk && isSelectingElements}
				/>
				{storyChatHeader?.storyChat?.canChat && (
					<StoryAskBar storyId={storyId} isOwner={storyChatHeader.storyChat.isOwner} />
				)}
			</div>
		</div>
	);
}

/** A reader of a shared story asks about it in a quick question: the story has no chat of theirs to quote it in. */
function askAboutSharedStoryElement({ text, block, intent }: StoryElementCitation) {
	requestAsk({ chatId: null, selection: { text, block, intent } });
}
