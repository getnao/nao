import { Store } from './abstract-store';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest } from '@nao/shared/story-app';

interface StoryEditTargetBase {
	chatId: string;
	storySlug: string;
	versionNumber: number;
}

export interface StoryBlockEditTarget extends StoryEditTargetBase {
	payload: StoryBlockEditPayload;
}

export interface StoryTableFormatEditTarget extends StoryEditTargetBase {
	request: StoryTableFormatEditRequest;
}

export type StoryEditTarget =
	| ({ kind: 'chart' } & StoryBlockEditTarget)
	| ({ kind: 'table' } & StoryTableFormatEditTarget);

/** Each opening gets its own id, so the form starts fresh even when the same block is opened again. */
type StoryBlockEditSession = StoryEditTarget & { id: number };

/** The custom-story block being edited in the chat column, next to the story it belongs to. */
class StoryBlockEditStore extends Store<StoryBlockEditSession | null> {
	protected state: StoryBlockEditSession | null = null;
	private nextId = 0;

	open = (target: StoryEditTarget) => {
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
