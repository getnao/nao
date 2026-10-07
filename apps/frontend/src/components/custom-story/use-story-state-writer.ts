import { useCallback, useEffect, useRef } from 'react';
import { saveStoryState } from './story-data-options';
import type { StoryStateChange } from '@nao/shared/story-app';

import type { CustomStoryDataSource } from './story-data-options';

const STATE_SAVE_DELAY_MS = 300;

interface PendingSave {
	change: StoryStateChange;
	dataSource: CustomStoryDataSource;
	timer: ReturnType<typeof setTimeout>;
}

export function useStoryStateWriter(dataSource: CustomStoryDataSource): (change: StoryStateChange) => void {
	const pendingRef = useRef(new Map<string, PendingSave>());

	useEffect(() => {
		const pending = pendingRef.current;
		return () => {
			for (const key of [...pending.keys()]) {
				savePending(pending, key);
			}
		};
	}, []);

	return useCallback(
		(change: StoryStateChange) => {
			const pending = pendingRef.current;
			clearTimeout(pending.get(change.key)?.timer);
			pending.set(change.key, {
				change,
				dataSource,
				timer: setTimeout(() => savePending(pending, change.key), STATE_SAVE_DELAY_MS),
			});
		},
		[dataSource],
	);
}

function savePending(pending: Map<string, PendingSave>, key: string): void {
	const entry = pending.get(key);
	if (!entry) {
		return;
	}
	clearTimeout(entry.timer);
	pending.delete(key);
	saveStoryState(entry.dataSource, entry.change).catch((error: unknown) => {
		console.warn(`[nao-story] The story state "${key}" could not be saved.`, error);
	});
}
