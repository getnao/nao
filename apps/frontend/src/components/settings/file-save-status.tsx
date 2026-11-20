import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { isMac } from '@/lib/platform';

const SAVED_NOTICE_MS = 2_000;
const SAVE_SHORTCUT_LABEL = isMac ? '⌘S' : 'Ctrl+S';

/**
 * Says in words whether the edits of the open file are saved, with a Save button, for people who do not watch the
 * tab dot or know the shortcut.
 */
export function FileSaveStatus({
	isDirty,
	isSaving,
	savedAt,
	onSave,
}: {
	isDirty: boolean;
	isSaving: boolean;
	/** When the last save succeeded, to confirm it for a moment. */
	savedAt: number | null;
	onSave: () => void;
}) {
	const isSavedNoticeShown = useIsRecent(savedAt);

	if (isSaving) {
		return (
			<span role='status' className='flex shrink-0 items-center gap-1.5'>
				<Spinner className='size-3' />
				Saving…
			</span>
		);
	}
	if (isDirty) {
		return (
			<span role='status' className='flex shrink-0 items-center gap-2'>
				<span className='flex items-center gap-1.5 text-foreground/80'>
					<span aria-hidden='true' className='size-1.5 rounded-full bg-amber-500' />
					Unsaved changes
				</span>
				<Button type='button' variant='outline' className='h-6 gap-1.5 px-2 text-[11px]' onClick={onSave}>
					Save
					<kbd className='font-sans text-muted-foreground'>{SAVE_SHORTCUT_LABEL}</kbd>
				</Button>
			</span>
		);
	}
	if (isSavedNoticeShown) {
		return (
			<span role='status' className='flex shrink-0 items-center gap-1'>
				<Check className='size-3' />
				Saved
			</span>
		);
	}
	return null;
}

function useIsRecent(timestamp: number | null): boolean {
	const [isRecent, setIsRecent] = useState(false);

	useEffect(() => {
		if (timestamp === null) {
			return;
		}
		setIsRecent(true);
		const timeout = window.setTimeout(() => setIsRecent(false), SAVED_NOTICE_MS);
		return () => window.clearTimeout(timeout);
	}, [timestamp]);

	return isRecent;
}
