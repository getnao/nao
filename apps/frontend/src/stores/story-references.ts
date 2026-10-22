import { useSyncExternalStore } from 'react';
import { Store } from './abstract-store';
import type { StoryReferences } from '@/lib/story-reference';
import { NO_STORY_REFERENCES } from '@/lib/story-reference';

class ValueStore<T> extends Store<T> {
	protected state: T;

	constructor(initialState: T) {
		super();
		this.state = initialState;
	}

	set = (value: T) => {
		if (this.state === value) {
			return;
		}
		this.state = value;
		this.notify();
	};

	getSnapshot = () => this.state;
}

/** Stories and story folders to reference in the input of the next new chat. */
export const pendingStoryReferencesStore = new ValueStore<StoryReferences>(NO_STORY_REFERENCES);

/** Stories and folders the stories page selection would reference, carried by dragging any selected card. */
export const selectedStoryReferencesStore = new ValueStore<StoryReferences>(NO_STORY_REFERENCES);

/** Whether a story or folder dragged on the stories page is above the "New chat" button of the sidebar. */
export const storyDragOverNewChatStore = new ValueStore<boolean>(false);

/** Hands the pending references over once, even when the consuming effect runs twice. */
export function takePendingStoryReferences(): StoryReferences {
	const references = pendingStoryReferencesStore.getSnapshot();
	pendingStoryReferencesStore.set(NO_STORY_REFERENCES);
	return references;
}

export const usePendingStoryReferences = () =>
	useSyncExternalStore(pendingStoryReferencesStore.subscribe, pendingStoryReferencesStore.getSnapshot);

export const useStoryDragOverNewChat = () =>
	useSyncExternalStore(storyDragOverNewChatStore.subscribe, storyDragOverNewChatStore.getSnapshot);
