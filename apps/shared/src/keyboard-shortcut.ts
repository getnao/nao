export type Shortcut = {
	mod?: boolean;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	key: string;
};

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export type KeydownSnapshot = ShortcutKeyEvent & Pick<KeyboardEvent, 'repeat'>;

export const isMac =
	typeof navigator !== 'undefined' &&
	(navigator.platform.includes('Mac') || /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));

export function matchesShortcut(event: ShortcutKeyEvent, shortcut: Shortcut): boolean {
	if (shortcut.ctrl) {
		return (
			event.ctrlKey &&
			!event.metaKey &&
			event.shiftKey === Boolean(shortcut.shift) &&
			event.altKey === Boolean(shortcut.alt) &&
			event.key.toLowerCase() === shortcut.key.toLowerCase()
		);
	}

	const modPressed = isMac ? event.metaKey : event.ctrlKey;
	const otherModPressed = isMac ? event.ctrlKey : event.metaKey;

	if (modPressed !== Boolean(shortcut.mod) || otherModPressed) {
		return false;
	}
	if (event.altKey !== Boolean(shortcut.alt)) {
		return false;
	}
	if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
		return false;
	}
	if (shortcut.shift) {
		return event.shiftKey;
	}
	if (isLetterKey(shortcut.key) && event.shiftKey) {
		return false;
	}

	return true;
}

export function hasModifier(event: ShortcutKeyEvent): boolean {
	return event.ctrlKey || event.metaKey || event.altKey;
}

export function snapshotKeydown({ key, ctrlKey, metaKey, shiftKey, altKey, repeat }: KeyboardEvent): KeydownSnapshot {
	return { key, ctrlKey, metaKey, shiftKey, altKey, repeat };
}

export function replayKeydown(target: EventTarget, snapshot: KeydownSnapshot): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { ...snapshot, bubbles: true, cancelable: true }));
}

function isLetterKey(key: string): boolean {
	return /^[a-z]$/i.test(key);
}
