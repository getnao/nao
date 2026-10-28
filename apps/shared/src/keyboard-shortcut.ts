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

export const ADD_SELECTION_TO_CHAT_SHORTCUT: Shortcut = { mod: true, key: 'l' };

const MODIFIER_HOLD_DELAY_MS = 150;

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

/**
 * Reports the platform's mod key held on its own, with a short delay so shortcuts like Mod+C don't count as a hold.
 * Pointer events resync the hold when focus moves to another document, and only the top window releases it on blur.
 */
export function watchModifierHold(target: Window, onChange: (isHeld: boolean) => void): () => void {
	const modifierKey = isMac ? 'Meta' : 'Control';
	const controller = new AbortController();
	const options = { signal: controller.signal, capture: true };
	let isHeld = false;
	let isPressingShortcut = false;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;

	const setHeld = (next: boolean) => {
		clearTimeout(holdTimer);
		holdTimer = undefined;
		if (next !== isHeld) {
			isHeld = next;
			onChange(next);
		}
	};
	const release = () => setHeld(false);
	const syncWithPointer = (event: PointerEvent) => {
		if (!isModifierPressed(event)) {
			isPressingShortcut = false;
			release();
		} else if (!isHeld && !isPressingShortcut && (event.type === 'pointerdown' || holdTimer === undefined)) {
			setHeld(true);
		}
	};

	target.addEventListener(
		'keydown',
		(event) => {
			if (event.key !== modifierKey) {
				isPressingShortcut = isModifierPressed(event);
				release();
			} else if (!event.repeat) {
				isPressingShortcut = false;
				clearTimeout(holdTimer);
				holdTimer = setTimeout(() => setHeld(true), MODIFIER_HOLD_DELAY_MS);
			}
		},
		options,
	);
	target.addEventListener(
		'keyup',
		(event) => {
			if (event.key === modifierKey) {
				isPressingShortcut = false;
				release();
			}
		},
		options,
	);
	target.addEventListener('pointermove', syncWithPointer, options);
	target.addEventListener('pointerdown', syncWithPointer, options);
	if (target.top === target) {
		target.addEventListener('blur', release, options);
	}

	return () => {
		clearTimeout(holdTimer);
		controller.abort();
	};
}

export function isModifierPressed(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
	return isMac ? event.metaKey : event.ctrlKey;
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
