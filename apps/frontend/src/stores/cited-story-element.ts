import { useSyncExternalStore } from 'react';
import { ValueStore } from './value-store';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { CitationData } from '@nao/shared/types';
import { isCodeCitation } from '@/lib/citation-mention';

/** A story element cited: its story shows its rendered view, and a tabbed story the tab holding it. */
export interface CitedStoryElementRequest {
	id: number;
	storySlug?: string;
	element: StoryElementAsk;
	requestedAt: number;
}

const citedStoryElementStore = new ValueStore<CitedStoryElementRequest | null>(null);
let nextRequestId = 0;

export function requestCitedStoryElement(citation: CitationData): void {
	if (isCodeCitation(citation)) {
		return;
	}
	const { block = { kind: 'text' }, text, storySlug } = citation;
	nextRequestId += 1;
	citedStoryElementStore.set({ id: nextRequestId, storySlug, element: { block, text }, requestedAt: Date.now() });
}

export const useCitedStoryElementRequest = () =>
	useSyncExternalStore(citedStoryElementStore.subscribe, citedStoryElementStore.getSnapshot);
