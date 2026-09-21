import type { UIMessage } from '@nao/backend/chat';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { findStoryIds } from '@/lib/story.utils';

const storyIdsByMessages = new WeakMap<UIMessage[], string[]>();

export function useStoryIds(): string[] {
	return useAgentMessagesSelector(findCachedStoryIds, areStoryIdsEqual);
}

function findCachedStoryIds(messages: UIMessage[]): string[] {
	const cachedStoryIds = storyIdsByMessages.get(messages);
	if (cachedStoryIds) {
		return cachedStoryIds;
	}

	const storyIds = findStoryIds(messages);
	storyIdsByMessages.set(messages, storyIds);
	return storyIds;
}

function areStoryIdsEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((storyId, index) => storyId === right[index]);
}
