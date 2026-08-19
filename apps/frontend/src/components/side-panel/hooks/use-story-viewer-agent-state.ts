import { useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentMessages, useOptionalAgentContext } from '@/contexts/agent.provider';
import { findStories, findStoryDraft } from '@/lib/story.utils';

export const useStoryViewerAgentState = (
	storySlug: string,
	messages?: UIMessage[] | null,
	isChatAgentRunning = false,
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
	const draftStory = useMemo(() => findStoryDraft(effectiveMessages, storySlug), [effectiveMessages, storySlug]);
	const latestStoryOutputVersion = useMemo(
		() => findLatestStoryOutputVersion(effectiveMessages, storySlug),
		[effectiveMessages, storySlug],
	);

	const { isStoryStreaming, isStoryInterrupted } = useMemo(
		() => getLatestRelevantStoryAgentState(effectiveMessages, storySlug, isRunning),
		[effectiveMessages, storySlug, isRunning],
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

export function getLatestRelevantStoryAgentState(messages: UIMessage[], storySlug: string, isRunning: boolean) {
	const partState = findLatestRelevantStoryPartState(messages, storySlug);
	const isInputStreaming = partState?.isInputStreaming ?? false;
	const isPersistedInterruption = partState?.isInterrupted ?? false;

	return {
		isStoryStreaming: isInputStreaming && !isPersistedInterruption,
		isStoryInterrupted: isInputStreaming && (isPersistedInterruption || !isRunning),
	};
}

function findLatestRelevantStoryPartState(messages: UIMessage[], storySlug: string) {
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

			return {
				isInputStreaming: part.state === 'input-streaming',
				isInterrupted: messages[m]?.stopReason === 'interrupted',
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
			if (part.type !== 'tool-story' || !part.output?.success || !isStoryIdMatch(storySlug, part.output.id)) {
				continue;
			}

			return part.output.version;
		}
	}

	return null;
}
