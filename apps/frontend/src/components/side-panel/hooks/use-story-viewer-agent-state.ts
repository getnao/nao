import { useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentMessages, useOptionalAgentContext } from '@/contexts/agent.provider';
import { findStories, findStoryDraft, getStoryToolPartSlug } from '@/lib/story.utils';

export const useStoryViewerAgentState = (
	storySlug: string,
	messages?: UIMessage[] | null,
	isChatAgentRunning = false,
	storyId: string | null = null,
) => {
	const agent = useOptionalAgentContext();
	const agentMessages = useAgentMessages();

	const effectiveMessages = useMemo(
		() => (messages !== undefined ? (messages ?? []) : agentMessages),
		[messages, agentMessages],
	);
	const isAgentRunningFromContext =
		messages === undefined && (agent?.status === 'streaming' || agent?.status === 'submitted');
	const isRunning = messages === undefined ? isAgentRunningFromContext : isChatAgentRunning;

	const allStories = useMemo(() => findStories(effectiveMessages), [effectiveMessages]);
	const draftStory = useMemo(
		() => findStoryDraft(effectiveMessages, storySlug, storyId),
		[effectiveMessages, storySlug, storyId],
	);
	const latestStoryOutputVersion = useMemo(
		() => findLatestStoryOutputVersion(effectiveMessages, storySlug),
		[effectiveMessages, storySlug],
	);

	const { isStoryStreaming, isStoryInterrupted } = useMemo(
		() => getLatestRelevantStoryAgentState(effectiveMessages, storySlug, isRunning, storyId),
		[effectiveMessages, storySlug, isRunning, storyId],
	);

	const isStoryUpdating = isStoryStreaming && isRunning;
	const isAgentRunning = isAgentRunningFromContext || isStoryUpdating;

	return {
		allStories,
		draftStory,
		latestStoryOutputVersion,
		isAgentRunning,
		isStoryUpdating,
		isStoryInterrupted,
	};
};

export function getLatestRelevantStoryAgentState(
	messages: UIMessage[],
	storySlug: string,
	isRunning: boolean,
	storyId: string | null = null,
) {
	const partState = findLatestRelevantStoryPartState(messages, storySlug, storyId);
	const isStreamingInput = partState?.isInputStreaming ?? false;
	const isAbandonedByInterruption = Boolean(partState?.isInterrupted && !partState.hasCompletedOutput);

	return {
		isStoryStreaming: isStreamingInput && !isAbandonedByInterruption,
		isStoryInterrupted: isAbandonedByInterruption || (isStreamingInput && !isRunning),
	};
}

function findLatestRelevantStoryPartState(messages: UIMessage[], storySlug: string, storyId: string | null) {
	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts ?? [];

		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p];
			if (part.type !== 'tool-story' || part.output?.story_chat_id) {
				continue;
			}

			const id = getStoryToolPartSlug(part, { slug: storySlug, id: storyId });
			if (!id || !isStoryIdMatch(storySlug, id)) {
				continue;
			}

			return {
				isInputStreaming: part.state === 'input-streaming',
				isInterrupted: messages[m]?.stopReason === 'interrupted',
				hasCompletedOutput: part.state === 'output-available',
			};
		}
	}

	return null;
}

function isStoryIdMatch(expectedId: string, candidateId: string) {
	return expectedId === candidateId || expectedId.startsWith(candidateId) || candidateId.startsWith(expectedId);
}

function findLatestStoryOutputVersion(messages: UIMessage[], storySlug: string) {
	for (let m = messages.length - 1; m >= 0; m--) {
		const parts = messages[m]?.parts ?? [];

		for (let p = parts.length - 1; p >= 0; p--) {
			const part = parts[p];
			if (
				part.type !== 'tool-story' ||
				!part.output?.success ||
				part.output.story_chat_id ||
				!isStoryIdMatch(storySlug, part.output.id)
			) {
				continue;
			}

			return part.output.version;
		}
	}

	return null;
}
