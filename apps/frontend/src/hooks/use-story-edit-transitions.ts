import { useCallback } from 'react';
import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import type { StorySaveResult } from '@/lib/story-save';

function didSaveSucceed(result: StorySaveResult) {
	return result === 'saved' || result === 'unchanged';
}

export function useStoryEditTransitions({
	viewMode,
	setViewMode,
	isDirty,
	isCodeValid,
	isSaving,
	save,
	requestExit,
}: {
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
	isDirty: boolean;
	isCodeValid: boolean;
	isSaving: boolean;
	save: () => Promise<StorySaveResult>;
	requestExit: (action: () => void) => void;
}) {
	const requestViewMode = useCallback(
		async (targetMode: StoryViewMode) => {
			if (targetMode === viewMode || isSaving) {
				return;
			}

			const isSwitchingEditors =
				(viewMode === 'edit' && targetMode === 'code') || (viewMode === 'code' && targetMode === 'edit');
			if (isSwitchingEditors) {
				if (viewMode === 'code' && !isCodeValid) {
					return;
				}
				setViewMode(targetMode);
				return;
			}

			if ((viewMode === 'edit' || viewMode === 'code') && targetMode === 'preview') {
				if (viewMode === 'code' && !isCodeValid) {
					return;
				}
				const result = await save();
				if (didSaveSucceed(result)) {
					setViewMode(targetMode);
				}
				return;
			}

			setViewMode(targetMode);
		},
		[isCodeValid, isSaving, save, setViewMode, viewMode],
	);

	const requestCancel = useCallback(() => {
		if (!isDirty) {
			setViewMode('preview');
			return;
		}
		requestExit(() => setViewMode('preview'));
	}, [isDirty, requestExit, setViewMode]);

	return {
		requestViewMode,
		requestCancel,
	};
}
