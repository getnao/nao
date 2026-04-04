import { useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { findStories, findStoryDraft } from '@/lib/story.utils';

export const useStoryViewerAgentState = (
	storyId: string,
	messages?: UIMessage[] | null,
	isChatAgentRunning = false,
) => {
	const agent = useOptionalAgentContext();

	const effectiveMessages = useMemo(
		() => (messages !== undefined ? (messages ?? []) : (agent?.messages ?? [])),
		[messages, agent?.messages],
	);

	const allStories = useMemo(() => findStories(effectiveMessages), [effectiveMessages]);
	const draftStory = useMemo(() => findStoryDraft(effectiveMessages, storyId), [effectiveMessages, storyId]);

	const isStoryStreaming = useMemo(
		() =>
			effectiveMessages.some((msg) =>
				msg.parts.some((p) => p.type === 'tool-story' && p.state === 'input-streaming'),
			),
		[effectiveMessages],
	);

	const isAgentRunningFromContext =
		messages === undefined && (agent?.status === 'streaming' || agent?.status === 'submitted');
	const isStoryStreamingRelevant = messages === undefined ? isStoryStreaming : isStoryStreaming && isChatAgentRunning;
	const isAgentRunning = isAgentRunningFromContext || isStoryStreamingRelevant;

	return {
		allStories,
		draftStory,
		isAgentRunning,
	};
};
