import type { UIMessage } from '@nao/backend/chat';
import type { StoryDraft, StorySummary } from '@/lib/story.utils';
import { useAgentMessagesSelector, useOptionalAgentContext } from '@/contexts/agent.provider';
import { areStoriesEqual, findStories, findStoryDraft, getStoryToolPartSlug } from '@/lib/story.utils';

interface StoryViewerMessagesState {
	allStories: StorySummary[];
	draftStory: StoryDraft | null;
	latestStoryOutputVersion: number | null;
	isStoryStreaming: boolean;
	isStoryInterrupted: boolean;
}

export const useStoryViewerAgentState = (
	storySlug: string,
	messages?: UIMessage[] | null,
	isChatAgentRunning = false,
	storyId: string | null = null,
) => {
	const agent = useOptionalAgentContext();
	const isAgentRunningFromContext =
		messages === undefined && (agent?.status === 'streaming' || agent?.status === 'submitted');
	const isRunning = messages === undefined ? isAgentRunningFromContext : isChatAgentRunning;

	const { allStories, draftStory, latestStoryOutputVersion, isStoryStreaming, isStoryInterrupted } =
		useAgentMessagesSelector(
			(agentMessages) =>
				readStoryViewerMessagesState(
					messages !== undefined ? (messages ?? []) : agentMessages,
					storySlug,
					isRunning,
					storyId,
				),
			areStoryViewerMessagesStatesEqual,
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

function readStoryViewerMessagesState(
	messages: UIMessage[],
	storySlug: string,
	isRunning: boolean,
	storyId: string | null,
): StoryViewerMessagesState {
	return {
		allStories: findStories(messages),
		draftStory: findStoryDraft(messages, storySlug, storyId),
		latestStoryOutputVersion: findLatestStoryOutputVersion(messages, storySlug),
		...getLatestRelevantStoryAgentState(messages, storySlug, isRunning, storyId),
	};
}

function areStoryViewerMessagesStatesEqual(left: StoryViewerMessagesState, right: StoryViewerMessagesState): boolean {
	return (
		areStoriesEqual(left.allStories, right.allStories) &&
		areStoryDraftsEqual(left.draftStory, right.draftStory) &&
		left.latestStoryOutputVersion === right.latestStoryOutputVersion &&
		left.isStoryStreaming === right.isStoryStreaming &&
		left.isStoryInterrupted === right.isStoryInterrupted
	);
}

function areStoryDraftsEqual(left: StoryDraft | null, right: StoryDraft | null): boolean {
	return (
		left === right ||
		(!!left &&
			!!right &&
			left.id === right.id &&
			left.title === right.title &&
			left.code === right.code &&
			left.isStreaming === right.isStreaming)
	);
}

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
