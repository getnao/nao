import { useBlocker } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { StoryUnsavedChangesDialogProps } from '@/components/story-unsaved-changes-dialog';
import type { StorySaveResult } from '@/lib/story-save';

type ExitAction = () => void;

export function getStoryNavigationBlockerOptions(isDirty: boolean) {
	return {
		shouldBlockFn: () => isDirty,
		enableBeforeUnload: isDirty,
		disabled: !isDirty,
		withResolver: true as const,
	};
}

export function useStoryExitGuard({
	isDirty,
	canSave,
	save,
	discard,
}: {
	isDirty: boolean;
	canSave: boolean;
	save: () => Promise<StorySaveResult>;
	discard: () => void;
}) {
	const [pendingExit, setPendingExit] = useState<ExitAction | null>(null);
	const [isSavingForExit, setIsSavingForExit] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const navigationBlocker = useBlocker(getStoryNavigationBlockerOptions(isDirty));

	const requestExit = useCallback(
		(action: ExitAction) => {
			if (!isDirty) {
				action();
				return;
			}
			setSaveFailed(false);
			setPendingExit(() => action);
		},
		[isDirty],
	);

	const clearPendingExit = useCallback(() => {
		setPendingExit(null);
		setSaveFailed(false);
		if (navigationBlocker.status === 'blocked') {
			navigationBlocker.reset();
		}
	}, [navigationBlocker]);

	const continueExit = useCallback(() => {
		if (navigationBlocker.status === 'blocked') {
			navigationBlocker.proceed();
		} else {
			pendingExit?.();
		}
		setPendingExit(null);
	}, [navigationBlocker, pendingExit]);

	const saveAndContinue = useCallback(async () => {
		if (!canSave || isSavingForExit) {
			return;
		}
		setIsSavingForExit(true);
		setSaveFailed(false);
		const result = await save();
		setIsSavingForExit(false);
		if (result === 'failed' || result === 'invalid' || result === 'unavailable') {
			setSaveFailed(result === 'failed' || result === 'unavailable');
			return;
		}
		continueExit();
	}, [canSave, continueExit, isSavingForExit, save]);

	const leaveWithoutSaving = useCallback(() => {
		discard();
		continueExit();
	}, [continueExit, discard]);

	const dialogProps: StoryUnsavedChangesDialogProps = {
		open: pendingExit !== null || navigationBlocker.status === 'blocked',
		canSave,
		isSaving: isSavingForExit,
		saveFailed,
		onKeepEditing: clearPendingExit,
		onSaveAndContinue: () => void saveAndContinue(),
		onLeaveWithoutSaving: leaveWithoutSaving,
	};

	return {
		requestExit,
		dialogProps,
	};
}
