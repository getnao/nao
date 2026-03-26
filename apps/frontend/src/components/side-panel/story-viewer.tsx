import { useCallback, useRef, useState } from 'react';
import { ShareStoryDialog } from '../share-dialog.story';
import { StoryEditor } from './story-editor';
import { LiveStorySettingsDialog } from './live-story-settings-dialog';
import { ArchivedBanner } from './story-archived-banner';
import { StoryHeader } from './story-header';
import { StoryPreview } from './story-preview';
import { StoryCodeView } from './story-code-view';
import { useStoryViewerAgentState } from './hooks/use-story-viewer-agent-state';
import { useStoryViewerContent } from './hooks/use-story-viewer-content';
import { useStoryViewerEnlarge } from './hooks/use-story-viewer-enlarge';
import { useStoryViewerLiveSettings } from './hooks/use-story-viewer-live-settings';
import { useStoryViewerSharing } from './hooks/use-story-viewer-sharing';
import { useStoryViewerStreamScroll } from './hooks/use-story-viewer-stream-scroll';
import { useStoryViewerSwitchStory } from './hooks/use-story-viewer-switch-story';
import { useStoryViewerVersionActions } from './hooks/use-story-viewer-version-actions';
import { useStoryViewerVersions } from './hooks/use-story-viewer-versions';
import { useStoryViewerViewMode } from './hooks/use-story-viewer-view-mode';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { useSidePanel } from '@/contexts/side-panel';

interface StoryViewerProps {
	chatId: string;
	storyId: string;
}

export function StoryViewer({ chatId, storyId }: StoryViewerProps) {
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { close: closeSidePanel, isReadonlyMode } = useSidePanel();
	const { viewMode, setViewMode } = useStoryViewerViewMode();
	const { allStories, draftStory, isAgentRunning } = useStoryViewerAgentState(storyId);
	const resolvedStoryId = draftStory?.id ?? storyId;
	const {
		versions,
		storyTitle: storedTitle,
		archivedAt,
		currentVersion,
		currentVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
	} = useStoryViewerVersions({ chatId, storyId: resolvedStoryId, isAgentRunning });
	const { storyTitle, storyCode, queryData, cachedAt } = useStoryViewerContent({
		storyId,
		resolvedStoryId,
		chatId,
		draftStory,
		currentVersion,
		storedTitle,
	});
	const { handleSave, handleRestore } = useStoryViewerVersionActions({
		chatId,
		storyId: resolvedStoryId,
		storyTitle: storedTitle,
		currentVersionCode: currentVersion?.code,
		isViewingLatest,
		tiptapEditorRef,
		setViewMode,
	});
	const { isShareDialogOpen, setIsShareDialogOpen, isShared } = useStoryViewerSharing({
		chatId,
		storyId: resolvedStoryId,
	});
	const {
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating: isLiveUpdating,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	} = useStoryViewerLiveSettings({ chatId, storyId: resolvedStoryId });
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const { handleEnlarge } = useStoryViewerEnlarge({ chatId, storyId: resolvedStoryId });

	const handleOpenShare = useCallback(() => setIsShareDialogOpen(true), [setIsShareDialogOpen]);
	const handleOpenLiveSettings = useCallback(() => setIsLiveSettingsOpen(true), []);

	const renderStoryViewer = useCallback(
		(nextStoryId: string) => <StoryViewer chatId={chatId} storyId={nextStoryId} />,
		[chatId],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });

	useStoryViewerStreamScroll({
		scrollContainerRef,
		isStreaming: Boolean(draftStory?.isStreaming),
		code: storyCode,
		viewMode,
	});

	if (!storyCode) {
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
				{isAgentRunning ? 'Waiting for story stream...' : 'No Story content available.'}
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col'>
			<StoryHeader
				title={storyTitle}
				storyId={resolvedStoryId}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={currentVersionNumber}
				totalVersions={versions.length}
				onPreviousVersion={goToPreviousVersion}
				onNextVersion={goToNextVersion}
				isViewingLatest={isViewingLatest}
				onRestore={handleRestore}
				onSave={handleSave}
				onShare={handleOpenShare}
				onEnlarge={handleEnlarge}
				isShared={isShared}
				isAgentRunning={isAgentRunning}
				isReadonlyMode={isReadonlyMode}
				isLive={isLive}
				isRefreshing={isRefreshing}
				onRefreshData={handleRefreshData}
				onOpenLiveSettings={handleOpenLiveSettings}
				onClose={closeSidePanel}
			/>

			{Boolean(archivedAt) && <ArchivedBanner chatId={chatId} storyId={resolvedStoryId} />}

			<div ref={scrollContainerRef} className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<StoryPreview
						code={storyCode}
						cacheSchedule={cacheSchedule}
						queryData={queryData ?? null}
						chatId={chatId}
						versionKey={`${currentVersionNumber}-${cachedAt ?? ''}`}
					/>
				) : viewMode === 'edit' ? (
					<StoryEditor code={storyCode} editorRef={tiptapEditorRef} onSave={handleSave} />
				) : (
					<StoryCodeView code={storyCode} />
				)}
			</div>

			<ShareStoryDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				chatId={chatId}
				storyId={resolvedStoryId}
			/>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				isLive={isLive}
				isLiveTextDynamic={isLiveTextDynamic}
				cacheSchedule={cacheSchedule}
				cacheScheduleDescription={cacheScheduleDescription}
				isUpdating={isLiveUpdating}
				onSaveSettings={handleSaveSettings}
			/>
		</div>
	);
}
