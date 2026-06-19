import { useEffect, useRef, useState } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/react';

import type { StoryCodeViewHandle } from '@/components/side-panel/story-code-view';
import { useStoryViewerVersionActions } from '@/components/side-panel/hooks/use-story-viewer-version-actions';
import { useStoryViewerVersions } from '@/components/side-panel/hooks/use-story-viewer-versions';
import { useStoryViewerViewMode } from '@/components/side-panel/hooks/use-story-viewer-view-mode';

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
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
	} = useStoryViewerVersions({ chatId, storySlug, isAgentRunning, isReadonlyMode });

	const code = currentVersion?.code ?? latestCode;

	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const codeViewRef = useRef<StoryCodeViewHandle | null>(null);
	const [isCodeDirty, setIsCodeDirty] = useState(false);
	const [isCodeValid, setIsCodeValid] = useState(true);

	const { handleSave, handleRestore } = useStoryViewerVersionActions({
		chatId,
		storySlug,
		storyTitle,
		currentVersionCode: code,
		isViewingLatest,
		tiptapEditorRef,
		codeViewRef,
		viewMode,
		setViewMode,
	});

	useEffect(() => {
		if (viewMode !== 'code') {
			setIsCodeDirty(false);
			setIsCodeValid(true);
		}
	}, [viewMode]);

	return {
		viewMode,
		setViewMode,
		code,
		storyId,
		tiptapEditorRef,
		codeViewRef,
		isCodeDirty,
		setIsCodeDirty,
		isCodeValid,
		setIsCodeValid,
		handleSave,
		handleRestore,
		versionNav: {
			currentVersion: currentVersionNumber,
			totalVersions: versions.length,
			isViewingLatest,
			goToPrevious: goToPreviousVersion,
			goToNext: goToNextVersion,
		},
	};
}
