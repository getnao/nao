import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { ReadonlyAgentMessagesProvider, useOptionalAgentContext } from '@/contexts/agent.provider';
import { Spinner } from '@/components/ui/spinner';
import { chatActivityStore } from '@/stores/chat-activity';
import { trpc } from '@/main';

interface StoryViewerProps {
	chatId: string;
	storySlug: string;
	isReadonlyMode?: boolean;
}

export function StoryViewer({ chatId, storySlug, isReadonlyMode: readonlyProp }: StoryViewerProps) {
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { close: closeSidePanel, isReadonlyMode: contextReadonlyMode, shareId } = useSidePanel();
	const isReadonlyMode = readonlyProp ?? contextReadonlyMode;
	const { viewMode, setViewMode } = useStoryViewerViewMode();

	const outerAgent = useOptionalAgentContext();
	const outerAgentHasCorrectChat = outerAgent?.chatId === chatId;
	const chatQuery = useQuery({
		...trpc.chat.get.queryOptions({ chatId }),
		staleTime: Infinity,
		enabled: !outerAgentHasCorrectChat,
	});
	const chatMessages = outerAgentHasCorrectChat ? undefined : (chatQuery.data?.messages ?? null);

	const isChatAgentRunning = useSyncExternalStore(
		useCallback((cb) => chatActivityStore.subscribe(chatId, cb), [chatId]),
		useCallback(() => chatActivityStore.getActivity(chatId).running, [chatId]),
	);

	const { allStories, draftStory, isAgentRunning } = useStoryViewerAgentState(
		storySlug,
		chatMessages,
		isChatAgentRunning,
	);
	const resolvedStorySlug = draftStory?.id ?? storySlug;
	const {
		versions,
		storyTitle: storedTitle,
		archivedAt,
		currentVersion,
		currentVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
	} = useStoryViewerVersions({ chatId, storySlug: resolvedStorySlug, isAgentRunning, isReadonlyMode });
	const { storyTitle, storyCode, queryData, cachedAt } = useStoryViewerContent({
		storySlug,
		resolvedStorySlug,
		chatId,
		draftStory,
		currentVersion,
		storedTitle,
		isReadonlyMode,
	});
	const { handleSave, handleRestore } = useStoryViewerVersionActions({
		chatId,
		storySlug: resolvedStorySlug,
		storyTitle: storedTitle,
		currentVersionCode: currentVersion?.code,
		isViewingLatest,
		tiptapEditorRef,
		setViewMode,
	});
	const { isShareDialogOpen, setIsShareDialogOpen, isShared } = useStoryViewerSharing({
		chatId,
		storySlug: resolvedStorySlug,
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
	} = useStoryViewerLiveSettings({ chatId, storySlug: resolvedStorySlug });
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const { handleEnlarge } = useStoryViewerEnlarge({ chatId, storySlug: resolvedStorySlug });

	const handleOpenShare = useCallback(() => setIsShareDialogOpen(true), [setIsShareDialogOpen]);
	const handleOpenLiveSettings = useCallback(() => setIsLiveSettingsOpen(true), []);

	const renderStoryViewer = useCallback(
		(nextStorySlug: string) => (
			<StoryViewer chatId={chatId} storySlug={nextStorySlug} isReadonlyMode={readonlyProp} />
		),
		[chatId, readonlyProp],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });

	useStoryViewerStreamScroll({
		scrollContainerRef,
		isStreaming: Boolean(draftStory?.isStreaming),
		code: storyCode,
		viewMode,
	});

	if (!storyCode) {
		if (chatQuery.isLoading) {
			return (
				<div className='flex h-full items-center justify-center'>
					<Spinner />
				</div>
			);
		}
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
				{isAgentRunning ? 'Waiting for story stream...' : 'No Story content available.'}
			</div>
		);
	}

	const content = (
		<div className='flex h-full flex-col'>
			<StoryHeader
				title={storyTitle}
				chatId={chatId}
				storySlug={resolvedStorySlug}
				shareId={shareId}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={currentVersionNumber}
				totalVersions={versions.length}
				versionNumber={currentVersion?.version}
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

			{Boolean(archivedAt) && <ArchivedBanner chatId={chatId} storySlug={resolvedStorySlug} />}

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
				storySlug={resolvedStorySlug}
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

	if (!chatMessages) {
		return content;
	}

	return <ReadonlyAgentMessagesProvider messages={chatMessages}>{content}</ReadonlyAgentMessagesProvider>;
}
