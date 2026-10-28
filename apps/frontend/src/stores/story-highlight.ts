import { useSyncExternalStore } from 'react';
import { ValueStore } from './value-store';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { CitationData } from '@nao/shared/types';

export interface StoryHighlightRequest {
	id: number;
	storySlug?: string;
	element: StoryElementAsk;
	requestedAt: number;
}

/** How long a story frame that is still loading may take to show a request it missed. */
export const STORY_HIGHLIGHT_TTL_MS = 10_000;

const storyHighlightStore = new ValueStore<StoryHighlightRequest | null>(null);
let nextRequestId = 0;

export function requestStoryHighlight({ block, text, storySlug }: CitationData): void {
	if (!block) {
		return;
	}
	nextRequestId += 1;
	storyHighlightStore.set({ id: nextRequestId, storySlug, element: { block, text }, requestedAt: Date.now() });
}

export const useStoryHighlightRequest = () =>
	useSyncExternalStore(storyHighlightStore.subscribe, storyHighlightStore.getSnapshot);
