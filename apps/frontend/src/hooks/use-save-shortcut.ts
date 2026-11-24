import { useEffect, useRef } from 'react';

import { matchesShortcut } from '@/lib/platform';

const SAVE_SHORTCUT = { mod: true, key: 's' };

/**
 * Saves on Mod+S anywhere on the page instead of opening the browser's save dialog.
 * Editors that handle the shortcut themselves prevent the event's default, so they keep precedence.
 */
export function useSaveShortcut(onSave: () => void) {
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || !matchesShortcut(event, SAVE_SHORTCUT)) {
				return;
			}
			event.preventDefault();
			if (!event.repeat) {
				onSaveRef.current();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);
}
