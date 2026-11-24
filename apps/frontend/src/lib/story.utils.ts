import type { UIMessage, UIToolPart } from '@nao/backend/chat';

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

const storiesByMessages = new WeakMap<UIMessage[], StorySummary[]>();
const storiesByMessage = new WeakMap<UIMessage, StorySummary[]>();

export interface ViewedStory {
	slug: string;
	id: string | null;
}

/** The slug a story tool call acts on, from its output when available and from the (possibly partial) input otherwise. */
export function getStoryToolPartSlug(part: UIToolPart<'story'>, viewedStory?: ViewedStory): string | undefined {
	if (part.output?.id) {
		return part.output.id;
	}
	if (part.input?.action === 'create') {
		return part.input.id;
	}
	return viewedStory && part.input?.id === viewedStory.id ? viewedStory.slug : undefined;
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
	const cachedStories = storiesByMessages.get(messages);
	if (cachedStories) {
		return cachedStories;
	}

	const titleById = new Map<string, string>();
	for (const story of messages.flatMap(findMessageStories)) {
		titleById.set(story.id, story.title);
	}

	const stories = [...titleById.entries()].map(([id, title]) => ({ id, title }));
	storiesByMessages.set(messages, stories);
	return stories;
}

export function areStoriesEqual(left: StorySummary[], right: StorySummary[]): boolean {
	return (
		left.length === right.length &&
		left.every((story, index) => story.id === right[index]?.id && story.title === right[index]?.title)
	);
}

export function findStoryIds(messages: UIMessage[]): string[] {
	return findStories(messages).map((s) => s.id);
}

/**
 * Finds the latest tool-story state for a specific story ID.
 * Prefers currently-streaming tool input, then falls back to latest code-bearing input/output.
 * A failed call never produced a version, so its input is not a draft to show.
 */
export function findStoryDraft(
	messages: UIMessage[],
	storyId: string,
	viewedStoryId?: string | null,
): StoryDraft | null {
	let prefixMatchedDraft: StoryDraft | null = null;

	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts ?? [];

		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p];
			if (part.type !== 'tool-story' || part.state === 'output-error' || part.output?.story_chat_id) {
				continue;
			}

			const input = part.input;
			const output = part.output;
			const id = getStoryToolPartSlug(part, { slug: storyId, id: viewedStoryId ?? null });
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

function findMessageStories(message: UIMessage): StorySummary[] {
	const cachedStories = storiesByMessage.get(message);
	if (cachedStories) {
		return cachedStories;
	}

	const stories = message.parts.flatMap((part) => {
		if (part.type !== 'tool-story') {
			return [];
		}
		const output = part.output;
		return output?.success && output.id && !output.story_chat_id ? [{ id: output.id, title: output.title }] : [];
	});
	storiesByMessage.set(message, stories);
	return stories;
}
