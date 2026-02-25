import type { UIMessage } from '@nao/backend/chat';

export interface StorySummary {
	id: string;
	title: string;
}

export interface StoryDraft {
	id: string;
	title: string;
	code: string;
	isStreaming: boolean;
}

const isStoryIdMatch = (expectedId: string, candidateId: string) => {
	return expectedId === candidateId;
};

const isStoryIdPrefixMatch = (expectedId: string, candidateId: string) => {
	return expectedId.startsWith(candidateId) || candidateId.startsWith(expectedId);
};

/**
 * Scans messages for story tool calls to find distinct stories.
 * Uses completed tool outputs only.
 */
export function findStories(messages: UIMessage[]): StorySummary[] {
	const seen = new Map<string, string>();

	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type !== 'tool-story') {
				continue;
			}

			const output = part.output;
			if (output?.success && output.id) {
				seen.set(output.id, output.title);
			}
		}
	}

	return [...seen.entries()].map(([id, title]) => ({ id, title }));
}

export function findStoryIds(messages: UIMessage[]): string[] {
	return findStories(messages).map((s) => s.id);
}

/**
 * Finds the latest tool-story state for a specific story ID.
 * Prefers currently-streaming tool input, then falls back to latest code-bearing input/output.
 */
export function findStoryDraft(messages: UIMessage[], storyId: string): StoryDraft | null {
	let prefixMatchedDraft: StoryDraft | null = null;

	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts ?? [];

		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p];
			if (part.type !== 'tool-story') {
				continue;
			}

			const input = part.input;
			const output = part.output;
			const id = output?.id ?? input?.id;
			if (!id) {
				continue;
			}

			const code = part.state === 'input-streaming' ? input?.code : (output?.code ?? input?.code);
			if (!code) {
				continue;
			}

			const draft: StoryDraft = {
				id,
				title: output?.title ?? input?.title ?? id,
				code,
				isStreaming: part.state === 'input-streaming',
			};

			if (isStoryIdMatch(storyId, id)) {
				return draft;
			}

			if (!prefixMatchedDraft && isStoryIdPrefixMatch(storyId, id)) {
				prefixMatchedDraft = draft;
			}
		}
	}

	return prefixMatchedDraft;
}
