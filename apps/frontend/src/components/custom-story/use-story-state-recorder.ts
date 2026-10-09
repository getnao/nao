import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { stateOptions } from './story-data-options';
import { useStoryStateWriter } from './use-story-state-writer';
import type { StoryStateChange, StoryStateSnapshot } from '@nao/shared/story-app';

import type { CustomStoryDataSource } from './story-data-options';

/** Every state change is saved as it happens: a shared one for every viewer, any other for the current viewer only. */
export function useStoryStateRecorder(
	dataSource: CustomStoryDataSource,
	reportError: (message: string) => void,
): (change: StoryStateChange) => void {
	const queryClient = useQueryClient();
	const handleSaveError = useCallback(
		(message: string) => {
			reportError(message);
			void queryClient.invalidateQueries({ queryKey: stateOptions(dataSource).queryKey });
		},
		[dataSource, queryClient, reportError],
	);
	const saveLater = useStoryStateWriter(dataSource, handleSaveError);

	return useCallback(
		(change: StoryStateChange) => {
			queryClient.setQueryData<StoryStateSnapshot>(
				stateOptions(dataSource).queryKey,
				(current) => current && applyChange(current, change),
			);
			saveLater(change);
		},
		[dataSource, queryClient, saveLater],
	);
}

function applyChange(snapshot: StoryStateSnapshot, { key, value, shared }: StoryStateChange): StoryStateSnapshot {
	const scope = shared ? 'shared' : 'own';
	const values = { ...snapshot[scope] };
	if (value === null) {
		delete values[key];
	} else {
		values[key] = value;
	}
	return { ...snapshot, [scope]: values };
}
