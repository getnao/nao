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
	return values[key];
}

export function writeStoryState(key: string, value: unknown): void {
	const removed = value === undefined || value === null;
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

export function replaceStoryState(next: StoryStateValues): void {
	values = next;
	notify();
}

export function subscribeToStoryState(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}
