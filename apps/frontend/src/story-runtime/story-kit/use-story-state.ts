import { useCallback, useRef, useSyncExternalStore } from 'react';
import { readStoryState, subscribeToStoryState, writeStoryState } from '../story-state';

export type StoryStateSetter<T> = (next: T | ((current: T) => T)) => void;

/** Like `useState`, but the value is saved with the story and comes back on the next visit. */
export function useStoryState<T>(key: string, initialValue: T): [T, StoryStateSetter<T>] {
	const initialRef = useRef(initialValue);
	initialRef.current = initialValue;
	const stored = useSyncExternalStore(subscribeToStoryState, () => readStoryState(key));
	const value = stored === undefined ? initialValue : (stored as T);

	const setValue = useCallback<StoryStateSetter<T>>(
		(next) => {
			const current = readStoryState(key);
			const base = current === undefined ? initialRef.current : (current as T);
			const resolved = typeof next === 'function' ? (next as (current: T) => T)(base) : next;
			writeStoryState(key, resolved);
		},
		[key],
	);
	return [value, setValue];
}
