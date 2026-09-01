import { useCallback, useEffect, useRef, useState } from 'react';
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
	const editBuffer = useStoryEditBuffer(code);
	const codeBuffer = useStoryEditBuffer(code);
	const isCodeDirty = codeBuffer.isDirty;
	const handleVersionSaved = useCallback(
		(savedCode: string) => {
			if (viewMode === 'edit') {
				editBuffer.markSaved(savedCode);
			} else if (viewMode === 'code') {
				codeBuffer.markSaved(savedCode);
			}
		},
		[codeBuffer, editBuffer, viewMode],
	);

	const { handleSave, saveCurrentVersion, handleRestore, isSaving } = useStoryViewerVersionActions({
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode: code,
		isViewingLatest,
		goToLatestVersion,
		tiptapEditorRef,
		codeViewRef,
		getEditModeCode: editBuffer.getCode,
		viewMode,
		setViewMode,
		onVersionSaved: handleVersionSaved,
	});
	const isDirty = viewMode === 'edit' ? editBuffer.isDirty : viewMode === 'code' && isCodeDirty;
	const discardChanges = useCallback(() => {
		if (viewMode === 'edit') {
			editBuffer.discard();
		} else {
			codeBuffer.discard();
		}
	}, [codeBuffer, editBuffer, viewMode]);
	const exitGuard = useStoryExitGuard({
		isDirty,
		canSave: viewMode !== 'code' || isCodeValid,
		save: saveCurrentVersion,
		discard: discardChanges,
	});
	const transitions = useStoryEditTransitions({
		viewMode,
		setViewMode,
		isEditDirty: editBuffer.isDirty,
		isCodeDirty,
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
		isEditDirty: editBuffer.isDirty,
		editCode: selectStoryEditorCode({
			persistedCode: code,
			bufferCode: editBuffer.getCode(),
			isDirty: editBuffer.isDirty,
			isSaving,
		}),
		onEditCodeChange: editBuffer.handleCodeChange,
		isCodeDirty,
		codeDraft: selectStoryEditorCode({
			persistedCode: code,
			bufferCode: codeBuffer.getCode(),
			isDirty: codeBuffer.isDirty,
			isSaving,
		}),
		onCodeChange: codeBuffer.handleCodeChange,
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
