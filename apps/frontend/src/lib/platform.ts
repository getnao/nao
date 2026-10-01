import { isMac } from '@nao/shared/keyboard-shortcut';
import type { Shortcut } from '@nao/shared/keyboard-shortcut';

export { isMac, matchesShortcut } from '@nao/shared/keyboard-shortcut';
export type { Shortcut } from '@nao/shared/keyboard-shortcut';

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

function formatKey(key: string): string {
	if (key.toLowerCase() === 'escape') {
		return 'Esc';
	}
	return key.length === 1 ? key.toUpperCase() : key;
}
