import { useCallback } from 'react';
import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import type { StorySaveResult } from '@/lib/story-save';

function didSaveSucceed(result: StorySaveResult) {
	return result === 'saved' || result === 'unchanged';
}

export function useStoryEditTransitions({
	viewMode,
	setViewMode,
	isEditDirty,
	isCodeDirty,
	isSaving,
	save,
	requestExit,
}: {
	viewMode: StoryViewMode;
	setViewMode: (mode: StoryViewMode) => void;
	isEditDirty: boolean;
	isCodeDirty: boolean;
	isSaving: boolean;
	save: () => Promise<StorySaveResult>;
	requestExit: (action: () => void) => void;
}) {
	const requestViewMode = useCallback(
		async (targetMode: StoryViewMode) => {
			if (targetMode === viewMode || isSaving) {
				return;
			}
			if (viewMode === 'edit') {
				const result = await save();
				if (didSaveSucceed(result)) {
					setViewMode(targetMode);
				}
				return;
			}
			if (viewMode === 'code' && isCodeDirty) {
				requestExit(() => setViewMode(targetMode));
				return;
			}
			setViewMode(targetMode);
		},
		[isCodeDirty, isSaving, requestExit, save, setViewMode, viewMode],
	);

	const requestCancel = useCallback(() => {
		const isDirty = viewMode === 'edit' ? isEditDirty : viewMode === 'code' && isCodeDirty;
		if (!isDirty) {
			setViewMode('preview');
			return;
		}
		requestExit(() => setViewMode('preview'));
	}, [isCodeDirty, isEditDirty, requestExit, setViewMode, viewMode]);

	return {
		requestViewMode,
		requestCancel,
	};
}
