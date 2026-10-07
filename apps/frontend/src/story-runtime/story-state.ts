import { MAX_STORY_STATE_VALUE_BYTES, STORY_STATE_KEY_PATTERN } from '@nao/shared/story-app';
import type { StoryStateChange, StoryStateValues } from '@nao/shared/story-app';

type PersistChange = (change: StoryStateChange) => void;

const listeners = new Set<() => void>();
let values: StoryStateValues = {};
let persist: PersistChange | null = null;

export function initStoryState(initial: StoryStateValues | undefined, persistChange: PersistChange | null): void {
	values = initial ?? {};
	persist = persistChange;
	notify();
}

export function readStoryState(key: string): unknown {
	return Object.hasOwn(values, key) ? values[key] : undefined;
}

export function writeStoryState(key: string, value: unknown): void {
	const removed = value === undefined || value === null;
	assertValidKey(key);
	if (!removed) {
		assertValueSize(key, value);
	}
	const next = { ...values };
	if (removed) {
		delete next[key];
	} else {
		next[key] = value;
	}
	values = next;
	notify();
	persist?.({ key, value: removed ? null : value });
}

export function subscribeToStoryState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The host would reject these on save, so the story fails loudly instead of showing a value that is never kept. */
function assertValidKey(key: string): void {
	if (!STORY_STATE_KEY_PATTERN.test(key)) {
		throw new Error(
			`"${key}" is not a valid state key: use up to 100 letters, digits, dots, colons, dashes or underscores.`,
		);
	}
}

function assertValueSize(key: string, value: unknown): void {
	const serialized = JSON.stringify(value);
	if (serialized === undefined || (serialized === 'null' && value !== null)) {
		throw new Error(`State "${key}" must be a JSON value.`);
	}
	const bytes = new TextEncoder().encode(serialized).length;
	if (bytes > MAX_STORY_STATE_VALUE_BYTES) {
		throw new Error(
			`State "${key}" is ${bytes} bytes; a value may not exceed ${MAX_STORY_STATE_VALUE_BYTES} bytes.`,
		);
	}
}

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}
