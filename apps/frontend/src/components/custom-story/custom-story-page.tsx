import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import type { DownloadFormat, StoryBlockReference } from '@nao/shared/types';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest } from '@nao/shared/story-app';
import type { StoryBlockEditTarget, StoryTableFormatEditTarget } from '@/stores/story-block-edit';

import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
import type { CustomStoryViewMode } from '@/components/custom-story/custom-story-view-mode';
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
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { useStoryViewerSharing } from '@/components/side-panel/hooks/use-story-viewer-sharing';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { ArchivedBanner } from '@/components/side-panel/story-archived-banner';
import { StoryPageHeader } from '@/components/story-page-header';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc, trpcClient } from '@/main';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';

interface CustomStoryPreviewPageProps {
	chatId: string;
	storySlug: string;
	authorName?: string;
}

/** Full-page view of a custom story for its owner, with the same header as a classic story's page. */
export function CustomStoryPreviewPage({ chatId, storySlug, authorName }: CustomStoryPreviewPageProps) {
	const navigate = useNavigate();
	const story = useCustomStory(chatId, storySlug);
	const { customStoryCreationEnabled } = useEffectiveUserGroupFeatures();
	const { content } = story;
	const storyId = story.versionsQuery.data?.id ?? content?.storyId ?? null;
	const sharing = useStoryViewerSharing({ chatId, storySlug });
	const live = useStoryViewerLiveSettings({ chatId, storySlug });
	const [viewMode, setViewMode] = useState<CustomStoryViewMode>('app');
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<StoryBlockEditTarget | null>(null);
	const [tableFormatTarget, setTableFormatTarget] = useState<StoryTableFormatEditTarget | null>(null);
	const canEditBlocks = story.isViewingLatest && !story.isAgentRunning;

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
	const handleOpenChat = useCallback(() => {
		navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: storySlug } });
	}, [chatId, navigate, storySlug]);
	const handleAskBlock = useCallback(
		(block: StoryBlockReference) => {
			chatPendingCitationStore.setBlock(chatId, storySlug, block);
			handleOpenChat();
		},
		[chatId, handleOpenChat, storySlug],
	);

	useTrackViewDuration({ assetType: 'story', chatId, storyId, versionNumber: story.viewedVersion ?? undefined });

	return (
		<div className='flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<StoryPageHeader
				title={content?.title ?? story.versionsQuery.data?.title ?? storySlug}
				authorName={authorName}
				onOpenChat={handleOpenChat}
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

			{Boolean(content?.archivedAt) && <ArchivedBanner chatId={chatId} storySlug={storySlug} />}
			{story.restoreError && <ActionErrorBanner message={story.restoreError.message} />}

			<CustomStoryViewLayers
				viewMode={viewMode}
				app={
					<CustomStoryBody
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
	shareId: string;
	title: string;
	authorName: string;
	isLive: boolean;
	onOpenChat?: () => void;
	isOpeningChat?: boolean;
}

/** A custom story opened from a share link: data comes through the share, limited to the queries the story uses. */
export function SharedCustomStoryPage({
	shareId,
	title,
	authorName,
	isLive,
	onOpenChat,
	isOpeningChat,
}: SharedCustomStoryPageProps) {
	const queryClient = useQueryClient();
	const contentQuery = useQuery(trpc.storyShare.getCustomVersion.queryOptions({ shareId }));
	const content = contentQuery.data;
	const dataSource = useMemo<CustomStoryDataSource>(() => ({ kind: 'share', shareId }), [shareId]);

	const refreshMutation = useMutation(
		trpc.storyShare.refreshData.mutationOptions({
			onSettled: () =>
				Promise.all([
					queryClient.invalidateQueries({ queryKey: trpc.storyShare.get.queryKey({ shareId }) }),
					queryClient.invalidateQueries({ queryKey: trpc.storyShare.getCustomVersion.queryKey({ shareId }) }),
					queryClient.invalidateQueries({
						queryKey: trpc.storyShare.getCustomStoryQueryData.queryKey({ shareId }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.storyShare.getCustomStoryNarratives.queryKey({ shareId }),
					}),
				]),
		}),
	);
	const renderExport = useCallback(
		(format: DownloadFormat, html: string) =>
			trpcClient.storyShare.downloadCustom.mutate({ shareId, format, html }),
		[shareId],
	);
	const download = useCustomStoryDownload(content, dataSource, renderExport);

	return (
		<div className='flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background'>
			<StoryPageHeader
				title={content?.title ?? title}
				authorName={authorName}
				openChatLabel='Discuss story'
				onOpenChat={onOpenChat}
				isOpeningChat={isOpeningChat}
				live={
					isLive
						? {
								isLive: true,
								cachedAt: content?.cachedAt,
								lastRefreshFailure: content?.lastRefreshFailure,
								isRefreshing: refreshMutation.isPending,
								onRefresh: () => refreshMutation.mutate({ shareId }),
							}
						: undefined
				}
				download={{ shareId, isOwner: false, onDownload: download }}
			/>
			<CustomStoryBody
				dataSource={dataSource}
				content={content}
				isLoading={contentQuery.isLoading}
				error={contentQuery.error}
				hasPublishedVersion
			/>
		</div>
	);
}
