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
	storyChatId?: string;
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

export function requestAskAboutSelection({ text, start, end }: Omit<AskSelection, 'block'>, storySlug?: string): void {
	requestAsk({ chatId: null, selection: { text, start, end, storySlug } });
}

export function requestAskAboutElement({ text, block }: StoryElementAsk, storySlug?: string): void {
	requestAsk({ chatId: null, selection: { text, block, intent: 'ask', storySlug } });
}

/** Code selected in an editor: a story's source, or one of a custom story's files. */
export interface CodeSelection {
	text: string;
	lines: StoryCodeLines;
}

interface CodeSource {
	storySlug?: string;
	storyChatId?: string;
	filePath?: string;
}

export function requestAskAboutCode(selection: CodeSelection, source: CodeSource) {
	requestAsk({ chatId: null, selection: toCodeAsk(selection, source) });
}

export function toCodeAsk({ text, lines }: CodeSelection, { storySlug, storyChatId, filePath }: CodeSource): AskSelection {
	return { text, block: { kind: CODE_CITATION_KIND, title: filePath, lines }, intent: 'ask', storySlug, storyChatId };
}

export function toAskCitation({
	text,
	start = 0,
	end = 0,
	block,
	intent,
	storySlug,
	storyChatId,
}: AskSelection): CitationData {
	return { text, start, end, block, intent, storySlug, storyChatId };
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
