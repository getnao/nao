import { useEffect, useRef } from 'react';

import type { ShortcutDefinition, ShortcutId } from '@/lib/keyboard-shortcuts';
import { isTypingTarget, SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { matchesShortcut } from '@/lib/platform';

type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			for (const entry of SHORTCUTS) {
				const handler = handlersRef.current[entry.id];
				if (!handler) {
					continue;
				}
				if (isTypingTarget(event) && !isAllowedWhileTyping(entry)) {
					continue;
				}
				const shortcuts = [entry.shortcut, ...(entry.alternateShortcuts ?? [])];
				if (shortcuts.some((shortcut) => matchesShortcut(event, shortcut))) {
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

function isAllowedWhileTyping(entry: ShortcutDefinition): boolean {
	return Boolean(entry.allowInInput || entry.shortcut.mod || entry.shortcut.ctrl || entry.shortcut.alt);
}
