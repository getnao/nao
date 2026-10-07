import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { stateOptions } from './story-data-options';
import { useStoryStateWriter } from './use-story-state-writer';
import type { StoryStateChange, StoryStateSnapshot, StoryStateValues } from '@nao/shared/story-app';

import type { CustomStoryDataSource } from './story-data-options';

/** Every state change is saved as it happens: the owner's into the view everyone starts from, any other viewer's into their own. */
export function useStoryStateRecorder(
	dataSource: CustomStoryDataSource,
	reportError: (message: string) => void,
): (change: StoryStateChange) => void {
	const queryClient = useQueryClient();
	const saveLater = useStoryStateWriter(dataSource, reportError);

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

/** A viewer other than the owner starts from the owner's saved values and overrides the keys they changed. */
export function viewerStateOf(snapshot: StoryStateSnapshot | undefined): StoryStateValues {
	if (!snapshot) {
		return {};
	}
	return snapshot.isOwner ? snapshot.shared : { ...snapshot.shared, ...snapshot.own };
}

function applyChange(snapshot: StoryStateSnapshot, { key, value }: StoryStateChange): StoryStateSnapshot {
	const scope = snapshot.isOwner ? 'shared' : 'own';
	const values = { ...snapshot[scope] };
	if (value === null) {
		delete values[key];
	} else {
		values[key] = value;
	}
	return { ...snapshot, [scope]: values };
}
