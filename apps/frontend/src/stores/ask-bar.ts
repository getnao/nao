import { useSyncExternalStore } from 'react';
import { CODE_CITATION_KIND } from '@nao/shared/types';
import { ValueStore } from './value-store';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { CitationData, StoryBlockReference, StoryCitationIntent, StoryCodeLines } from '@nao/shared/types';

/** The part of the page the user asks about: selected text, with its position, or a block of a custom story. */
export type AskSelection = {
	text: string;
	start?: number;
	end?: number;
	block?: StoryBlockReference;
	intent?: StoryCitationIntent;
	storySlug?: string;
};

export type AskRequest = {
	id: number;
	chatId: string | null;
	selection?: AskSelection;
};

const askRequestStore = new ValueStore<AskRequest | null>(null);

let nextRequestId = 0;

export function requestAsk(request: Omit<AskRequest, 'id'> = { chatId: null }): void {
	nextRequestId += 1;
	askRequestStore.set({ ...request, id: nextRequestId });
}

export function requestAskAboutSelection({ text, start, end }: Omit<AskSelection, 'block'>): void {
	requestAsk({ chatId: null, selection: { text, start, end } });
}

export function requestAskAboutElement({ text, block }: StoryElementAsk, storySlug?: string): void {
	requestAsk({ chatId: null, selection: { text, block, intent: 'ask', storySlug } });
}

/** Code selected in an editor: a story's source, or one of a custom story's files. */
export interface CodeSelection {
	text: string;
	lines: StoryCodeLines;
}

export function requestAskAboutCode({ text, lines }: CodeSelection, source: { storySlug?: string; filePath?: string }) {
	const block = { kind: CODE_CITATION_KIND, title: source.filePath, lines };
	requestAsk({ chatId: null, selection: { text, block, intent: 'ask', storySlug: source.storySlug } });
}

export function toAskCitation({ text, start = 0, end = 0, block, intent, storySlug }: AskSelection): CitationData {
	return { text, start, end, block, intent, storySlug };
}

export const useAskRequest = () => useSyncExternalStore(askRequestStore.subscribe, askRequestStore.getSnapshot);

export type AskQuestion = {
	chatId: string;
};

const handedOverQuestions = new Map<string, AskQuestion>();

export function handOverQuestion(storyId: string, question: AskQuestion): void {
	handedOverQuestions.set(storyId, question);
}

export function getHandedOverQuestion(storyId: string): AskQuestion | undefined {
	return handedOverQuestions.get(storyId);
}

export function forgetHandedOverQuestion(storyId: string): void {
	handedOverQuestions.delete(storyId);
}
