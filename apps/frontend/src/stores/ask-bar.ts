import { useSyncExternalStore } from 'react';
import { ValueStore } from './value-store';
import type { StoryBlockReference } from '@nao/shared/types';

/** The part of the page the user asks about: selected text, with its position, or a block of a custom story. */
export type AskSelection = {
	text: string;
	start?: number;
	end?: number;
	block?: StoryBlockReference;
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

export const useAskRequest = () => useSyncExternalStore(askRequestStore.subscribe, askRequestStore.getSnapshot);

export type AskQuestion = {
	chatId: string;
	selection?: AskSelection;
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
