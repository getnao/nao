import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseStoryTabs, stripStoryTabsMarkup } from '@nao/shared/story-tabs';
import { ShareStoryDialog } from '../share-dialog.story';
import { StoryUnsavedChangesDialog } from '../story-unsaved-changes-dialog';
import { StoryEditor } from './story-editor';
import { LiveStorySettingsDialog } from './live-story-settings-dialog';
import { ArchivedBanner } from './story-archived-banner';
import { StoryContentLoading } from './story-content-loading';
import { StoryHeader } from './story-header';
import { StoryPreview } from './story-preview';
import { StoryCodeView } from './story-code-view';
import { StoryTabsBar } from './story-tabs-bar';
import { StoryTabbedEditor } from './story-tabbed-editor';
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
import type { StoryCodeViewHandle } from './story-code-view';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { useSidePanel } from '@/contexts/side-panel';
import { useDragAutoScroll } from '@/hooks/use-drag-auto-scroll';
import { useStoryVersionQueryData } from '@/hooks/use-story-version-query-data';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { selectStoryEditorCode, useStoryEditBuffer } from '@/hooks/use-story-edit-buffer';
import { useStoryEditTransitions } from '@/hooks/use-story-edit-transitions';
import { useStoryExitGuard } from '@/hooks/use-story-exit-guard';
import { ReadonlyAgentMessagesProvider, useOptionalAgentContext } from '@/contexts/agent.provider';
import { StoryChartEditProvider } from '@/contexts/story-chart-edit';
import { StoryMapEditProvider } from '@/contexts/story-map-edit';
import { StoryTableEditProvider } from '@/contexts/story-table-edit';
import { StoryEmbedDataProvider } from '@/contexts/story-embed-data';
import { Spinner } from '@/components/ui/spinner';
import { chatActivityStore } from '@/stores/chat-activity';
import { useRegisterStoryBeforeAgentSend } from '@/contexts/story-before-agent-send';
import { trpc } from '@/main';

interface StoryViewerProps {
	chatId: string;
	storySlug: string;
	isReadonlyMode?: boolean;
	initialTabIndex?: number;
}

export function StoryViewer({ chatId, storySlug, isReadonlyMode: readonlyProp, initialTabIndex }: StoryViewerProps) {
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const codeViewRef = useRef<StoryCodeViewHandle | null>(null);
	const tabbedEditCodeRef = useRef<(() => string) | null>(null);
	const [isCodeValid, setIsCodeValid] = useState(true);
	const [activeTabIndex, setActiveTabIndex] = useState(initialTabIndex ?? 0);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const {
		close: closeSidePanel,
		isVisible: isSidePanelVisible,
		currentStorySlug,
		isReadonlyMode: contextReadonlyMode,
		registerBeforeChange,
		shareId,
		shareType,
		setCurrentStorySlug,
		setCurrentStoryTabIndex,
	} = useSidePanel();
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

	const { allStories, draftStory, latestStoryOutputVersion, isAgentRunning, isStoryUpdating, isStoryInterrupted } =
		useStoryViewerAgentState(storySlug, chatMessages, isChatAgentRunning);
	const resolvedStorySlug = draftStory?.id ?? storySlug;
	const isStoryStreaming = Boolean(draftStory?.isStreaming);
	const prevSlugRef = useRef(resolvedStorySlug);
	const {
		versions,
		storyId,
		storyTitle: storedTitle,
		archivedAt,
		currentVersion,
		currentVersionNumber,
		storedVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
		goToLatestVersion,
	} = useStoryViewerVersions({
		chatId,
		storySlug: resolvedStorySlug,
		isAgentRunning,
		latestStoryOutputVersion,
		isReadonlyMode,
	});
	const {
		storyTitle,
		storyCode,
		queryData,
		cachedAt,
		lastRefreshFailure,
		isLoading: isContentLoading,
	} = useStoryViewerContent({
		storySlug,
		resolvedStorySlug,
		chatId,
		draftStory,
		currentVersion,
		storedTitle,
		isViewingLatest,
		isStoryInterrupted,
		isReadonlyMode,
	});
	const { queryData: versionQueryData, isPending: isVersionQueryDataPending } = useStoryVersionQueryData({
		chatId,
		storySlug: resolvedStorySlug,
		versionNumber: storedVersionNumber,
		isViewingLatest,
		latestQueryData: queryData ?? null,
	});
	const tabs = useMemo(() => parseStoryTabs(storyCode ?? ''), [storyCode]);
	const isTabbedStory = Boolean(tabs?.length);
	const activeTab = tabs?.length ? Math.min(activeTabIndex, tabs.length - 1) : 0;
	const storyBuffer = useStoryEditBuffer(storyCode ?? '');
	const isCodeDirty = storyBuffer.isDirty;
	useTrackViewDuration({
		assetType: 'story',
		chatId,
		storySlug: resolvedStorySlug,
		storyId,
		versionNumber: storedVersionNumber > 0 ? storedVersionNumber : undefined,
	});

	const { handleSave, saveCurrentVersion, handleRestore, isSaving } = useStoryViewerVersionActions({
		chatId,
		storySlug: resolvedStorySlug,
		storyTitle,
		currentVersionCode: currentVersion?.code ?? storyCode,
		isViewingLatest,
		goToLatestVersion,
		codeViewRef,
		getCurrentCode: storyBuffer.getCode,
		viewMode,
		setViewMode,
		onVersionSaved: storyBuffer.markSaved,
	});
	const isDirty = storyBuffer.isDirty;
	const exitGuard = useStoryExitGuard({
		isDirty,
		canSave: viewMode !== 'code' || isCodeValid,
		save: saveCurrentVersion,
		discard: storyBuffer.discard,
	});
	const transitions = useStoryEditTransitions({
		viewMode,
		setViewMode,
		isDirty,
		isCodeValid,
		isSaving,
		save: saveCurrentVersion,
		requestExit: exitGuard.requestExit,
	});
	useEffect(() => registerBeforeChange(exitGuard.requestExit), [exitGuard.requestExit, registerBeforeChange]);
	const handleBeforeAgentSend = useCallback(async () => {
		if (!isDirty) {
			return { canSend: true };
		}
		if (viewMode === 'code' && !isCodeValid) {
			return { canSend: false };
		}
		const result = await saveCurrentVersion();
		if (result !== 'saved' && result !== 'unchanged') {
			return { canSend: false };
		}
		return {
			canSend: true,
			afterSend: () => setViewMode('preview'),
		};
	}, [isCodeValid, isDirty, saveCurrentVersion, setViewMode, viewMode]);
	useRegisterStoryBeforeAgentSend({
		chatId,
		enabled: !isReadonlyMode && isSidePanelVisible && currentStorySlug === resolvedStorySlug,
		guard: handleBeforeAgentSend,
	});
	const { isShareDialogOpen, setIsShareDialogOpen, isShared } = useStoryViewerSharing({
		chatId,
		storySlug: resolvedStorySlug,
	});
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
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
	const handleOpenAnalytics = useCallback(() => setIsAnalyticsOpen(true), []);
	const handleOpenLiveSettings = useCallback(() => setIsLiveSettingsOpen(true), []);

	const renderStoryViewer = useCallback(
		(nextStorySlug: string) => (
			<StoryViewer chatId={chatId} storySlug={nextStorySlug} isReadonlyMode={readonlyProp} />
		),
		[chatId, readonlyProp],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });
	const handlePreviousVersion = useCallback(
		() => exitGuard.requestExit(goToPreviousVersion),
		[exitGuard, goToPreviousVersion],
	);
	const handleNextVersion = useCallback(() => exitGuard.requestExit(goToNextVersion), [exitGuard, goToNextVersion]);

	useEffect(() => {
		if (viewMode !== 'code') {
			setIsCodeValid(true);
		}
	}, [viewMode]);

	useEffect(() => {
		if (prevSlugRef.current !== resolvedStorySlug) {
			prevSlugRef.current = resolvedStorySlug;
			setActiveTabIndex(0);
		}
	}, [resolvedStorySlug]);

	useEffect(() => {
		setCurrentStorySlug(resolvedStorySlug);
	}, [resolvedStorySlug, setCurrentStorySlug]);

	useEffect(() => {
		setCurrentStoryTabIndex(activeTab);
	}, [activeTab, setCurrentStoryTabIndex]);

	useStoryViewerStreamScroll({
		scrollContainerRef,
		isAppendingContent: Boolean(draftStory?.isStreaming),
		code: storyCode,
		viewMode,
	});
	useDragAutoScroll(scrollContainerRef);

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

	const editCode = selectStoryEditorCode({
		persistedCode: storyCode,
		bufferCode: storyBuffer.getCode(),
		isDirty: storyBuffer.isDirty,
		isSaving,
	});
	const editTabs = parseStoryTabs(editCode);
	const isEditTabbedStory = Boolean(editTabs?.length);
	const codeDraft = selectStoryEditorCode({
		persistedCode: storyCode,
		bufferCode: storyBuffer.getCode(),
		isDirty: storyBuffer.isDirty,
		isSaving,
	});
	const content = (
		<div className='flex h-full flex-col'>
			<StoryHeader
				title={storyTitle}
				chatId={chatId}
				storySlug={resolvedStorySlug}
				storyId={storyId}
				shareId={shareId}
				shareType={shareType}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={transitions.requestViewMode}
				currentVersion={currentVersionNumber}
				totalVersions={versions.length}
				versionNumber={currentVersion?.version}
				onPreviousVersion={handlePreviousVersion}
				onNextVersion={handleNextVersion}
				isViewingLatest={isViewingLatest}
				onRestore={handleRestore}
				onSave={handleSave}
				onCancel={transitions.requestCancel}
				onShare={handleOpenShare}
				onOpenAnalytics={handleOpenAnalytics}
				onEnlarge={handleEnlarge}
				isShared={isShared}
				isAgentRunning={isAgentRunning}
				isStoryUpdating={isStoryUpdating}
				isSaving={isSaving}
				isReadonlyMode={isReadonlyMode}
				isLive={isLive}
				isRefreshing={isRefreshing}
				onRefreshData={handleRefreshData}
				onOpenLiveSettings={handleOpenLiveSettings}
				onClose={closeSidePanel}
				isCodeDirty={isCodeDirty}
				isCodeValid={isCodeValid}
				cachedAt={cachedAt}
				lastRefreshFailure={lastRefreshFailure}
			/>

			{Boolean(archivedAt) && <ArchivedBanner chatId={chatId} storySlug={resolvedStorySlug} />}

			{viewMode === 'preview' && isTabbedStory && tabs && (
				<StoryTabsBar
					tabs={tabs.map((tab) => ({ title: tab.title }))}
					activeIndex={activeTab}
					onSelect={setActiveTabIndex}
					contentClassName='px-6'
				/>
			)}

			<div ref={scrollContainerRef} className='flex-1 min-h-0 overflow-auto'>
				{renderWithEditProvider(
					!isReadonlyMode && isViewingLatest && !archivedAt && !isAgentRunning && viewMode !== 'edit',
					{
						chatId,
						storySlug: resolvedStorySlug,
						storyTitle,
						storyCode,
					},
					viewMode === 'preview' ? (
						isContentLoading ? (
							<StoryContentLoading />
						) : (
							<StoryPreview
								code={
									isTabbedStory && tabs ? tabs[activeTab].innerCode : stripStoryTabsMarkup(storyCode)
								}
								fullCode={storyCode}
								cacheSchedule={cacheSchedule}
								queryData={versionQueryData}
								chatId={chatId}
								storySlug={resolvedStorySlug}
								versionKey={isViewingLatest ? undefined : currentVersionNumber}
								filtersEnabled={isViewingLatest && !isAgentRunning}
								isStreaming={isStoryStreaming}
								isDataPending={isVersionQueryDataPending}
								isViewingLatest={isViewingLatest}
							/>
						)
					) : viewMode === 'edit' ? (
						<StoryEmbedDataProvider value={versionQueryData}>
							{isEditTabbedStory ? (
								<StoryTabbedEditor
									code={editCode}
									editorRef={tiptapEditorRef}
									onSave={handleSave}
									onChange={storyBuffer.handleCodeChange}
									getCodeRef={tabbedEditCodeRef}
									barContentClassName='px-6'
									contentClassName='p-6'
								/>
							) : (
								<StoryEditor
									code={editCode}
									editorRef={tiptapEditorRef}
									onSave={handleSave}
									onChange={storyBuffer.handleCodeChange}
								/>
							)}
						</StoryEmbedDataProvider>
					) : (
						<StoryCodeView
							code={codeDraft}
							readOnly={isReadonlyMode}
							codeRef={codeViewRef}
							onCodeChange={storyBuffer.handleCodeChange}
							onValidChange={setIsCodeValid}
							onSave={handleSave}
						/>
					),
				)}
			</div>

			<ShareStoryDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				chatId={chatId}
				storySlug={resolvedStorySlug}
			/>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				chatId={chatId}
				storyId={storyId ?? undefined}
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
			<StoryUnsavedChangesDialog {...exitGuard.dialogProps} />
		</div>
	);

	if (!chatMessages) {
		return content;
	}

	return <ReadonlyAgentMessagesProvider messages={chatMessages}>{content}</ReadonlyAgentMessagesProvider>;
}

function renderWithEditProvider(
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
