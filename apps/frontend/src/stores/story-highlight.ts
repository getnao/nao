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

interface StoryRequest {
	storySlug?: string;
	requestedAt: number;
}

/** How long a story view that is still loading may take to follow a request it missed. */
const STORY_REQUEST_TTL_MS = 10_000;

const storyHighlightStore = new ValueStore<StoryHighlightRequest | null>(null);
let nextRequestId = 0;

export function requestStoryHighlight({ block, text, storySlug }: CitationData): void {
	if (!block) {
		return;
	}
	nextRequestId += 1;
	storyHighlightStore.set({ id: nextRequestId, storySlug, element: { block, text }, requestedAt: Date.now() });
}

export function isStoryRequestFor(request: StoryRequest, storySlug?: string): boolean {
	const isSameStory = !request.storySlug || !storySlug || request.storySlug === storySlug;
	return isSameStory && isStoryRequestFresh(request);
}

export function isStoryRequestFresh(request: StoryRequest): boolean {
	return Date.now() - request.requestedAt < STORY_REQUEST_TTL_MS;
}

export const useStoryHighlightRequest = () =>
	useSyncExternalStore(storyHighlightStore.subscribe, storyHighlightStore.getSnapshot);
