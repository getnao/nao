import { useSyncExternalStore } from 'react';
import { ValueStore } from './value-store';
import type { CitationData, StoryCodeLines } from '@nao/shared/types';

export interface CodeRevealRequest {
	id: number;
	storySlug?: string;
	filePath?: string;
	lines: StoryCodeLines;
	requestedAt: number;
}

const codeRevealStore = new ValueStore<CodeRevealRequest | null>(null);
let nextRequestId = 0;

export function requestCodeReveal({ block, storySlug }: CitationData): void {
	if (!block?.lines) {
		return;
	}
	setRequest({ storySlug, filePath: block.title || undefined, lines: block.lines });
}

/** Asks the view about to show a file, like a context file of the Context Hub, to show these lines of its source. */
export function requestFileLinesReveal(filePath: string, lines: StoryCodeLines): void {
	setRequest({ filePath, lines });
}

/** A shown request is done, so a code view opened later does not jump back to its lines. */
export function completeCodeReveal(id: number): void {
	if (codeRevealStore.getSnapshot()?.id === id) {
		codeRevealStore.set(null);
	}
}

export const useCodeRevealRequest = () => useSyncExternalStore(codeRevealStore.subscribe, codeRevealStore.getSnapshot);

function setRequest(request: Omit<CodeRevealRequest, 'id' | 'requestedAt'>): void {
	nextRequestId += 1;
	codeRevealStore.set({ ...request, id: nextRequestId, requestedAt: Date.now() });
}
