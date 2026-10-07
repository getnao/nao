import { useSyncExternalStore } from 'react';
import { requestStateDiscard, requestStateSave } from '../story-host';
import { readStorySaveStatus, subscribeToStoryState } from '../story-state';
import type { StoryStateSaveStatus } from '@nao/shared/story-app';

export interface StorySave extends StoryStateSaveStatus {
	save: () => void;
	discard: () => void;
}

/** For a story with auto-save off: its unsaved `useStoryState` changes, and the actions to keep or drop them. */
export function useStorySave(): StorySave {
	const status = useSyncExternalStore(subscribeToStoryState, readStorySaveStatus);
	return { ...status, save: requestStateSave, discard: requestStateDiscard };
}
