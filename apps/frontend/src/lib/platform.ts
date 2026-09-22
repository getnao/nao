export type Shortcut = {
	mod?: boolean;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	key: string;
};

export const isMac =
	typeof navigator !== 'undefined' &&
	(navigator.platform.includes('Mac') || /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));

export function formatShortcut(shortcut: Shortcut): string[] {
	const tokens: string[] = [];

	if (isMac) {
		if (shortcut.ctrl) {
			tokens.push('⌃');
		}
		if (shortcut.alt) {
			tokens.push('⌥');
		}
		if (shortcut.shift) {
			tokens.push('⇧');
		}
		if (shortcut.mod) {
			tokens.push('⌘');
		}
	} else {
		if (shortcut.ctrl) {
			tokens.push('Ctrl');
		}
		if (shortcut.mod) {
			tokens.push('Ctrl');
		}
		if (shortcut.alt) {
			tokens.push('Alt');
		}
		if (shortcut.shift) {
			tokens.push('Shift');
		}
	}

	tokens.push(formatKey(shortcut.key));
	return tokens;
}

export function formatShortcutLabel(shortcut: Shortcut): string {
	return formatShortcut(shortcut).join(isMac ? '' : '+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
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

function formatKey(key: string): string {
	if (key.toLowerCase() === 'escape') {
		return 'Esc';
	}
	return key.length === 1 ? key.toUpperCase() : key;
}

function isLetterKey(key: string): boolean {
	return /^[a-z]$/i.test(key);
}
