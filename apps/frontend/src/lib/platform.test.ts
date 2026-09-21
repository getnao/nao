import { describe, expect, it } from 'vitest';

import { isMac, matchesShortcut } from './platform';

describe('matchesShortcut', () => {
	it('matches mod+/ without shift', () => {
		expect(matchesShortcut(createModEvent('/'), { mod: true, key: '/' })).toBe(true);
	});

	it('matches mod+/ with shift', () => {
		expect(matchesShortcut(createModEvent('/', true), { mod: true, key: '/' })).toBe(true);
	});

	it('matches mod+: without shift', () => {
		expect(matchesShortcut(createModEvent(':'), { mod: true, key: ':' })).toBe(true);
	});

	it('matches mod+: with shift', () => {
		expect(matchesShortcut(createModEvent(':', true), { mod: true, key: ':' })).toBe(true);
	});

	it('rejects shift for mod+k', () => {
		expect(matchesShortcut(createModEvent('k', true), { mod: true, key: 'k' })).toBe(false);
	});

	it('requires shift for mod+shift+o', () => {
		const shortcut = { mod: true, shift: true, key: 'o' };

		expect(matchesShortcut(createModEvent('o'), shortcut)).toBe(false);
		expect(matchesShortcut(createModEvent('O', true), shortcut)).toBe(true);
	});

	it('keeps ctrl shortcuts shift-exact', () => {
		const shortcut = { ctrl: true, key: 'c' };

		expect(matchesShortcut(createKeyboardEvent('c', { ctrlKey: true }), shortcut)).toBe(true);
		expect(matchesShortcut(createKeyboardEvent('C', { ctrlKey: true, shiftKey: true }), shortcut)).toBe(false);
	});
});

function createModEvent(key: string, shiftKey = false): KeyboardEvent {
	return createKeyboardEvent(key, {
		metaKey: isMac,
		ctrlKey: !isMac,
		shiftKey,
	});
}

function createKeyboardEvent(
	key: string,
	overrides: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	} as KeyboardEvent;
}
