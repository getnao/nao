import type { UIMessage } from '@nao/backend/chat';

export interface StorySummary {
	id: string;
	title: string;
}

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
