import type { Shortcut } from '@/lib/platform';
import { formatShortcut, formatShortcutLabel } from '@/lib/platform';

export type ShortcutId =
	| 'toggle-sidebar'
	| 'command-menu'
	| 'new-chat'
	| 'go-to-stories'
	| 'keyboard-help'
	| 'stop-generation';
export type ShortcutGroup = 'General' | 'Navigation' | 'Chat';

export type ShortcutDefinition = {
	id: ShortcutId;
	label: string;
	group: ShortcutGroup;
	shortcut: Shortcut;
	allowInInput?: boolean;
};

export const SHORTCUTS: readonly ShortcutDefinition[] = [
	{
		id: 'toggle-sidebar',
		label: 'Toggle sidebar',
		group: 'General',
		shortcut: { mod: true, key: 'b' },
	},
	{
		id: 'command-menu',
		label: 'Command menu',
		group: 'General',
		shortcut: { mod: true, key: 'k' },
	},
	{
		id: 'keyboard-help',
		label: 'Keyboard shortcuts',
		group: 'General',
		shortcut: { mod: true, key: '/' },
	},
	{
		id: 'new-chat',
		label: 'New chat',
		group: 'Navigation',
		shortcut: { mod: true, shift: true, key: 'o' },
	},
	{
		id: 'go-to-stories',
		label: 'Go to Stories',
		group: 'Navigation',
		shortcut: { mod: true, shift: true, key: 's' },
	},
	{
		id: 'stop-generation',
		label: 'Cancel prompt',
		group: 'Chat',
		shortcut: { ctrl: true, key: 'c' },
	},
];

export function getShortcut(id: ShortcutId): ShortcutDefinition {
	const shortcut = SHORTCUTS.find((entry) => entry.id === id);
	if (!shortcut) {
		throw new Error(`Unknown keyboard shortcut: ${id}`);
	}
	return shortcut;
}

export function getShortcutTokens(id: ShortcutId): string[] {
	return formatShortcut(getShortcut(id).shortcut);
}

export function getShortcutLabel(id: ShortcutId): string {
	return formatShortcutLabel(getShortcut(id).shortcut);
}

export function isTypingTarget(event: KeyboardEvent): boolean {
	const target = event.target instanceof HTMLElement ? event.target : null;
	const activeElement = typeof document !== 'undefined' ? document.activeElement : null;

	return isEditableElement(target) || (activeElement instanceof HTMLElement && isEditableElement(activeElement));
}

function isEditableElement(element: HTMLElement | null): boolean {
	return element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
