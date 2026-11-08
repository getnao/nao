import { useCallback, useEffect, useState } from 'react';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest, StoryElementCitation } from '@nao/shared/story-app';

import type {
	StoryBlockEditTarget,
	StoryTableFormatEditTarget,
} from '@/components/custom-story/custom-story-block-edit';
import type { CustomStoryViewMode } from '@/components/custom-story/custom-story-view-mode';
import type { CodeSelection } from '@/stores/ask-bar';
import {
	CustomStoryBlockEditDialog,
	CustomStoryTableFormatDialog,
} from '@/components/custom-story/custom-story-block-edit';
import { ActionErrorBanner, CustomStoryBody, useActiveStoryTheme } from '@/components/custom-story/custom-story-body';
import { CustomStoryFiles } from '@/components/custom-story/custom-story-files';
import { CustomStoryViewLayers } from '@/components/custom-story/custom-story-view-mode';
import { rememberStatePrompt } from '@/components/custom-story/remember-state-header';
import { useCustomStory } from '@/components/custom-story/use-custom-story';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { ShareDialog } from '@/components/share-dialog';
import { useStoryViewerEnlarge } from '@/components/side-panel/hooks/use-story-viewer-enlarge';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { useStoryViewerSharing } from '@/components/side-panel/hooks/use-story-viewer-sharing';
import { useStoryViewerSwitchStory } from '@/components/side-panel/hooks/use-story-viewer-switch-story';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { ArchivedBanner } from '@/components/side-panel/story-archived-banner';
import { StoryHeader } from '@/components/side-panel/story-header';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { useRetryStaleStoryRefresh } from '@/hooks/use-retry-stale-story-refresh';
import { useCitedElementFollower } from '@/hooks/use-cited-element-follower';
import { useCodeRevealFollower } from '@/hooks/use-code-reveal';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useCloseWhenUneditable, useStoryEditSession } from '@/hooks/use-story-edit-session';
import { StoryEditPresenceBanner } from '@/components/story-edit-presence-banner';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { toAskCitation, toCodeAsk } from '@/stores/ask-bar';

interface CustomStoryViewerProps {
	chatId: string;
	storySlug: string;
}

/** Side-panel view of a custom story */
export function CustomStoryViewer({ chatId, storySlug }: CustomStoryViewerProps) {
	const {
		close,
		setCurrentStorySlug,
		isReadonlyMode,
		isReplay,
		shareSource,
		chatId: conversationChatId,
	} = useSidePanel();
	const citingChatId = conversationChatId ?? chatId;
	const story = useCustomStory(chatId, storySlug);
	const { customStoryCreationEnabled } = useEffectiveUserGroupFeatures();
	const { content } = story;
	const theme = useActiveStoryTheme(content?.theme);
	const storyId = story.versionsQuery.data?.id ?? content?.storyId ?? null;
	const [editTarget, setEditTarget] = useState<StoryBlockEditTarget | null>(null);
	const [tableFormatTarget, setTableFormatTarget] = useState<StoryTableFormatEditTarget | null>(null);
	const [hasFileChanges, setHasFileChanges] = useState(false);
	const presence = useStoryEditSession({
		target: !isReadonlyMode && storyId ? { storyId, chatId, storySlug } : null,
		isEditing: editTarget !== null || tableFormatTarget !== null || hasFileChanges,
	});
	const canEditBlocks =
		story.isViewingLatest &&
		!story.isAgentRunning &&
		!story.isArchived &&
		!isReadonlyMode &&
		!presence.isLockedByOthers;
	useCloseWhenUneditable(canEditBlocks, () => {
		setEditTarget(null);
		setTableFormatTarget(null);
	});

	const sharing = useStoryViewerSharing({ chatId, storySlug });
	const live = useStoryViewerLiveSettings({ chatId, storySlug });
	useRetryStaleStoryRefresh({
		storyKey: `${chatId}/${storySlug}`,
		needsRefresh: !isReadonlyMode && (content?.needsRefresh ?? false),
		isRefreshing: live.isRefreshing,
		refresh: live.handleRefreshData,
	});
	const { handleEnlarge } = useStoryViewerEnlarge({ storyId });
	const [viewMode, setViewMode] = useState<CustomStoryViewMode>('app');
	useCodeRevealFollower(storySlug, () => setViewMode('files'));
	useCitedElementFollower(storySlug, () => setViewMode('app'));
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();
	const canAsk = !isReadonlyMode;
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const renderStoryViewer = useCallback(
		(nextStorySlug: string) => <StoryViewer chatId={chatId} storySlug={nextStorySlug} />,
		[chatId],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });
	const agent = useOptionalAgentContext();

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
		(citation: StoryElementCitation) => {
			chatPendingCitationStore.addStoryElement(citingChatId, { chatId, slug: storySlug }, citation);
		},
		[citingChatId, chatId, storySlug],
	);

	const handleAskAboutCode = useCallback(
		(filePath: string, selection: CodeSelection) => {
			chatPendingCitationStore.add(
				citingChatId,
				toAskCitation(toCodeAsk(selection, { storySlug, storyChatId: chatId, filePath })),
			);
		},
		[citingChatId, chatId, storySlug],
	);

	const handleRememberState = useCallback(() => {
		if (content && agent) {
			void agent.queueOrSendMessage({ text: rememberStatePrompt(content.title, storySlug) });
		}
	}, [agent, content, storySlug]);

	useTrackViewDuration({
		assetType: 'story',
		chatId,
		storySlug,
		storyId,
		versionNumber: story.viewedVersion ?? undefined,
	});
	useEffect(() => {
		setCurrentStorySlug(storySlug);
	}, [setCurrentStorySlug, storySlug]);
	useEffect(() => {
		if (!canEditBlocks) {
			setEditTarget(null);
			setTableFormatTarget(null);
		}
	}, [canEditBlocks]);

	return (
		<div className='flex h-full w-full min-w-0 flex-1 flex-col'>
			<StoryHeader
				title={content?.title ?? story.versionsQuery.data?.title ?? storySlug}
				chatId={chatId}
				storySlug={storySlug}
				storyId={storyId}
				shareSource={shareSource}
				allStories={[]}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				elementSelection={
					canAsk ? { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements } : undefined
				}
				currentVersion={story.currentVersionIndex}
				versions={story.versions}
				versionNumber={story.viewedVersion ?? undefined}
				versionDate={story.viewedVersionDate}
				onSelectVersion={story.goToVersion}
				isViewingLatest={story.isViewingLatest}
				onRestore={story.restore}
				onShare={() => sharing.setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				onEnlarge={handleEnlarge}
				isShared={sharing.isShared}
				isAgentRunning={story.isAgentRunning}
				isEditLocked={presence.isLockedByOthers}
				isStoryUpdating={false}
				isSaving={story.isRestoring}
				isReadonlyMode={isReadonlyMode}
				isReplay={isReplay}
				isLive={live.isLive}
				isLiveUpdating={live.isUpdating}
				isRefreshing={live.isRefreshing}
				onRefreshData={live.handleRefreshData}
				onOpenLiveSettings={() => setIsLiveSettingsOpen(true)}
				onClose={close}
				cachedAt={content?.cachedAt}
				lastRefreshFailure={content?.lastRefreshFailure}
				onDownload={story.download}
			/>

			<StoryEditPresenceBanner presence={presence} />
			{story.isArchived && <ArchivedBanner chatId={chatId} storySlug={storySlug} />}
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
						onAsk={canAsk ? handleAsk : undefined}
						isSelectingElements={isSelectingElements && viewMode === 'app'}
						onRememberState={
							canEditBlocks && customStoryCreationEnabled && agent ? handleRememberState : undefined
						}
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
							onHasChangesChange={setHasFileChanges}
							onAskAboutCode={canAsk ? handleAskAboutCode : undefined}
						/>
					)
				}
			/>

			<CustomStoryBlockEditDialog
				target={canEditBlocks ? editTarget : null}
				theme={theme}
				onClose={() => setEditTarget(null)}
			/>
			<CustomStoryTableFormatDialog
				target={canEditBlocks ? tableFormatTarget : null}
				onClose={() => setTableFormatTarget(null)}
			/>
			<ShareDialog
				open={sharing.isShareDialogOpen}
				onOpenChange={sharing.setIsShareDialogOpen}
				target={{ kind: 'story', chatId: chatId, storySlug: storySlug }}
			/>
			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				chatId={chatId}
				storyId={storyId ?? undefined}
				storySlug={storySlug}
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
