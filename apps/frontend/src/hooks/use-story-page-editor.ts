import { useEffect, useRef, useState } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';

import type { StoryCodeViewHandle } from '@/components/side-panel/story-code-view';
import { useStoryViewerVersionActions } from '@/components/side-panel/hooks/use-story-viewer-version-actions';
import { useStoryViewerVersions } from '@/components/side-panel/hooks/use-story-viewer-versions';
import { useStoryViewerViewMode } from '@/components/side-panel/hooks/use-story-viewer-view-mode';
import { selectStoryEditorCode, useStoryEditBuffer } from '@/hooks/use-story-edit-buffer';
import { useStoryEditTransitions } from '@/hooks/use-story-edit-transitions';
import { useStoryExitGuard } from '@/hooks/use-story-exit-guard';

interface UseStoryPageEditorParams {
	chatId: string;
	storySlug: string;
	storyTitle: string;
	latestCode: string;
	isAgentRunning?: boolean;
	isReadonlyMode?: boolean;
}

export function useStoryPageEditor({
	chatId,
	storySlug,
	storyTitle,
	latestCode,
	isAgentRunning = false,
	isReadonlyMode = false,
}: UseStoryPageEditorParams) {
	const { viewMode, setViewMode } = useStoryViewerViewMode();
	const {
		versions,
		storyId,
		currentVersion,
		currentVersionNumber,
		storedVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
		goToLatestVersion,
	} = useStoryViewerVersions({ chatId, storySlug, isAgentRunning, isReadonlyMode });

	const code = currentVersion?.code ?? latestCode;

	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const codeViewRef = useRef<StoryCodeViewHandle | null>(null);
	const tabbedEditCodeRef = useRef<(() => string) | null>(null);
	const [isCodeValid, setIsCodeValid] = useState(true);
	const storyBuffer = useStoryEditBuffer(code);
	const isCodeDirty = storyBuffer.isDirty;

	const { handleSave, saveCurrentVersion, handleRestore, isSaving } = useStoryViewerVersionActions({
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode: code,
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

	useEffect(() => {
		if (viewMode !== 'code') {
			setIsCodeValid(true);
		}
	}, [viewMode]);

	return {
		viewMode,
		setViewMode: transitions.requestViewMode,
		handleCancel: transitions.requestCancel,
		code,
		storyId,
		tiptapEditorRef,
		codeViewRef,
		tabbedEditCodeRef,
		isEditDirty: storyBuffer.isDirty,
		editCode: selectStoryEditorCode({
			persistedCode: code,
			bufferCode: storyBuffer.getCode(),
			isDirty: storyBuffer.isDirty,
			isSaving,
		}),
		onEditCodeChange: storyBuffer.handleCodeChange,
		isCodeDirty,
		codeDraft: selectStoryEditorCode({
			persistedCode: code,
			bufferCode: storyBuffer.getCode(),
			isDirty: storyBuffer.isDirty,
			isSaving,
		}),
		onCodeChange: storyBuffer.handleCodeChange,
		isCodeValid,
		setIsCodeValid,
		handleSave,
		handleRestore,
		isSaving,
		exitDialog: exitGuard.dialogProps,
		versionNav: {
			currentVersion: currentVersionNumber,
			storedVersionNumber,
			totalVersions: versions.length,
			isViewingLatest,
			goToPrevious: () => exitGuard.requestExit(goToPreviousVersion),
			goToNext: () => exitGuard.requestExit(goToNextVersion),
		},
	};
}
