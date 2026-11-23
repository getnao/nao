import { TAG_ATTRS } from '@nao/shared/story-segments';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';

export type PendingStoryBlock = 'chart' | 'table' | 'map' | 'grid';

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

/**
 * Cuts the story block still being written off the end of streamed code, so its raw markup is never shown.
 * `pendingBlock` is the visual block being written, or null when the cut tag renders nothing (filter, tab...).
 */
export function holdBackIncompleteStoryBlock(code: string): { code: string; pendingBlock: PendingStoryBlock | null } {
	const openGridStart = findOpenGridStart(code);
	if (openGridStart !== null) {
		return { code: code.slice(0, openGridStart), pendingBlock: 'grid' };
	}
	const incompleteTag = findIncompleteTrailingTag(code);
	if (!incompleteTag) {
		return { code, pendingBlock: null };
	}
	return { code: code.slice(0, incompleteTag.start), pendingBlock: toPendingStoryBlock(incompleteTag.name) };
}

const STORY_TAG_START_REGEX = /<\/?(chart|table|map|filter|parameter|grid|tabs?)\b/g;
const PARTIAL_TAG_NAME_REGEX = /<\/?[a-z]*$/;

function findOpenGridStart(code: string): number | null {
	const lastGrid = [...code.matchAll(/<grid\b/g)].at(-1);
	return lastGrid && !code.includes('</grid>', lastGrid.index) ? lastGrid.index : null;
}

function findIncompleteTrailingTag(code: string): { start: number; name: string | null } | null {
	const lastTag = [...code.matchAll(STORY_TAG_START_REGEX)].at(-1);
	if (lastTag && !isCompleteTagAt(code, lastTag.index)) {
		return { start: lastTag.index, name: lastTag[1] };
	}
	const partialTagName = PARTIAL_TAG_NAME_REGEX.exec(code);
	return partialTagName ? { start: partialTagName.index, name: null } : null;
}

function isCompleteTagAt(code: string, start: number): boolean {
	const completeTagRegex = new RegExp(String.raw`<\/?[a-z]+\b${TAG_ATTRS}\/?>`, 'y');
	completeTagRegex.lastIndex = start;
	return completeTagRegex.test(code);
}

function toPendingStoryBlock(tagName: string | null): PendingStoryBlock | null {
	return tagName === 'chart' || tagName === 'table' || tagName === 'map' || tagName === 'grid' ? tagName : null;
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
