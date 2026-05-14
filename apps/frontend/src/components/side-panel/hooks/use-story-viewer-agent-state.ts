import { useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { findStories, findStoryDraft } from '@/lib/story.utils';

export const useStoryViewerAgentState = (
	storySlug: string,
	messages?: UIMessage[] | null,
	isChatAgentRunning = false,
) => {
	const agent = useOptionalAgentContext();

	const effectiveMessages = useMemo(
		() => (messages !== undefined ? (messages ?? []) : (agent?.messages ?? [])),
		[messages, agent?.messages],
	);

	const allStories = useMemo(() => findStories(effectiveMessages), [effectiveMessages]);
	const draftStory = useMemo(() => findStoryDraft(effectiveMessages, storySlug), [effectiveMessages, storySlug]);

	const isStoryStreaming = useMemo(
		() => isLatestRelevantStoryPartStreaming(effectiveMessages, storySlug),
		[effectiveMessages, storySlug],
	);

	const isAgentRunningFromContext =
		messages === undefined && (agent?.status === 'streaming' || agent?.status === 'submitted');
	const isStoryStreamingRelevant =
		isStoryStreaming && (messages === undefined ? isAgentRunningFromContext : isChatAgentRunning);
	const isAgentRunning = isAgentRunningFromContext || isStoryStreamingRelevant;

	return {
		allStories,
		draftStory,
		isAgentRunning,
	};
};

function isLatestRelevantStoryPartStreaming(messages: UIMessage[], storySlug: string) {
	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts ?? [];

		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p];
			if (part.type !== 'tool-story') {
				continue;
			}

			const id = part.output?.id ?? part.input?.id;
			if (!id || !isStoryIdMatch(storySlug, id)) {
				continue;
			}

			return part.state === 'input-streaming' && messages[m]?.stopReason !== 'interrupted';
		}
	}

	return false;
}

function isStoryIdMatch(expectedId: string, candidateId: string) {
	return expectedId === candidateId || expectedId.startsWith(candidateId) || candidateId.startsWith(expectedId);
}
