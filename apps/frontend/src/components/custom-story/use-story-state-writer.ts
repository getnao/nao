import { useCallback, useEffect, useRef } from 'react';
import { saveStoryState } from './story-data-options';
import type { StoryStateChange } from '@nao/shared/story-app';

import type { CustomStoryDataSource } from './story-data-options';

const STATE_SAVE_DELAY_MS = 300;

type ReportSaveError = (message: string) => void;

interface PendingSave {
	change: StoryStateChange;
	dataSource: CustomStoryDataSource;
	reportError: ReportSaveError;
	timer: ReturnType<typeof setTimeout>;
}

export function useStoryStateWriter(
	dataSource: CustomStoryDataSource,
	reportError: ReportSaveError,
): (change: StoryStateChange) => void {
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
			const pendingKey = pendingKeyOf(change);
			clearTimeout(pending.get(pendingKey)?.timer);
			pending.set(pendingKey, {
				change,
				dataSource,
				reportError,
				timer: setTimeout(() => savePending(pending, pendingKey), STATE_SAVE_DELAY_MS),
			});
		},
		[dataSource, reportError],
	);
}

/** A personal and a shared value may use the same key, so each scope keeps its own pending save. */
function pendingKeyOf({ key, shared }: StoryStateChange): string {
	return `${shared ? 'shared' : 'own'}:${key}`;
}

function savePending(pending: Map<string, PendingSave>, pendingKey: string): void {
	const entry = pending.get(pendingKey);
	if (!entry) {
		return;
	}
	clearTimeout(entry.timer);
	pending.delete(pendingKey);
	saveStoryState(entry.dataSource, entry.change).catch((error: unknown) => {
		const reason = error instanceof Error ? `: ${error.message}` : '.';
		entry.reportError(`The story state "${entry.change.key}" could not be saved${reason}`);
	});
}
