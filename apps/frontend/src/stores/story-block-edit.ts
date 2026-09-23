import { Store } from './abstract-store';
import type { StoryBlockEditPayload } from '@nao/shared/story-app';

export interface StoryBlockEditTarget {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	payload: StoryBlockEditPayload;
}

/** Each opening gets its own id, so the form starts fresh even when the same block is opened again. */
interface StoryBlockEditSession extends StoryBlockEditTarget {
	id: number;
}

/** The custom-story block being edited in the chat column, next to the story it belongs to. */
class StoryBlockEditStore extends Store<StoryBlockEditSession | null> {
	protected state: StoryBlockEditSession | null = null;
	private nextId = 0;

	open = (target: StoryBlockEditTarget) => {
		this.nextId += 1;
		this.state = { ...target, id: this.nextId };
		this.notify();
	};

	close = () => {
		if (this.state) {
			this.state = null;
			this.notify();
		}
	};

	getSnapshot = () => this.state;
}

export const storyBlockEditStore = new StoryBlockEditStore();
