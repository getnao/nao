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
	nextRequestId += 1;
	codeRevealStore.set({
		id: nextRequestId,
		storySlug,
		filePath: block.title || undefined,
		lines: block.lines,
		requestedAt: Date.now(),
	});
}

/** A shown request is done, so a code view opened later does not jump back to its lines. */
export function completeCodeReveal(id: number): void {
	if (codeRevealStore.getSnapshot()?.id === id) {
		codeRevealStore.set(null);
	}
}

export const useCodeRevealRequest = () => useSyncExternalStore(codeRevealStore.subscribe, codeRevealStore.getSnapshot);
