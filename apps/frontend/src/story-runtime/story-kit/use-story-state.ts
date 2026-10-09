import { useCallback, useRef, useSyncExternalStore } from 'react';
import { readStoryState, subscribeToStoryState, writeStoryState } from '../story-state';

export type StoryStateSetter<T> = (next: T | ((current: T) => T)) => void;

/** Like `useState`, but the value is saved for the current viewer and comes back on their next visit. */
export function useStoryState<T>(key: string, initialValue: T): [T, StoryStateSetter<T>] {
	return useSavedState(key, initialValue, false);
}

/** Like `useStoryState`, but one value shared by every viewer of the story: anyone can change it for everyone. */
export function useSharedStoryState<T>(key: string, initialValue: T): [T, StoryStateSetter<T>] {
	return useSavedState(key, initialValue, true);
}

function useSavedState<T>(key: string, initialValue: T, shared: boolean): [T, StoryStateSetter<T>] {
	const initialRef = useRef(initialValue);
	initialRef.current = initialValue;
	const stored = useSyncExternalStore(subscribeToStoryState, () => readStoryState(key, shared));
	const value = stored === undefined ? initialValue : (stored as T);

	const setValue = useCallback<StoryStateSetter<T>>(
		(next) => {
			const current = readStoryState(key, shared);
			const base = current === undefined ? initialRef.current : (current as T);
			const resolved = typeof next === 'function' ? (next as (current: T) => T)(base) : next;
			writeStoryState(key, resolved, shared);
		},
		[key, shared],
	);
	return [value, setValue];
}
