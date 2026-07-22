import { useEffect, useRef } from 'react';

import type { ShortcutId } from '@/lib/keyboard-shortcuts';
import { isTypingTarget, SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { matchesShortcut } from '@/lib/platform';

type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isTypingTarget(event)) {
				return;
			}

			for (const entry of SHORTCUTS) {
				const handler = handlersRef.current[entry.id];
				if (handler && matchesShortcut(event, entry.shortcut)) {
					event.preventDefault();
					if (!event.repeat) {
						handler();
					}
					return;
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);
}
