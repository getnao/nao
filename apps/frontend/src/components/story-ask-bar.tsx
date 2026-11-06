import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import { AskBar } from '@/components/ask-bar';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { trpc } from '@/main';
import { forgetHandedOverQuestion, getHandedOverQuestion, handOverQuestion } from '@/stores/ask-bar';

const STORY_ROUTERS = new Set(['story', 'storyShare', 'customStoryViewer', 'standaloneCustomStory']);

export const STORY_ASK_BAR_INSET = '6rem';
export const STORY_ASK_BAR_INSET_STYLE = { '--story-bottom-inset': STORY_ASK_BAR_INSET } as CSSProperties;

export function StoryAskBar({
	storyId,
	isOwner,
	isInputHidden = false,
}: {
	storyId: string;
	isOwner: boolean;
	isInputHidden?: boolean;
}) {
	const [handedOverQuestion] = useState(() => getHandedOverQuestion(storyId));
	const queryClient = useQueryClient();
	const askMutation = useMutation(
		trpc.chatFork.askStory.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: trpc.story.listQuickQuestions.queryKey({ storyId }) }),
		}),
	);

	useEffect(() => {
		forgetHandedOverQuestion(storyId);
	}, [storyId]);

	const [hasAttachedStoryChat, setHasAttachedStoryChat] = useState(false);
	const refreshStoryPage = () =>
		queryClient.invalidateQueries({ queryKey: trpc.story.resolve.queryKey({ storyId }) });

	const askStory = async () => {
		const response = await askMutation.mutateAsync({ storyId });
		if (response.hasAttachedStoryChat) {
			handOverQuestion(storyId, { chatId: response.chatId });
			setHasAttachedStoryChat(true);
		}
		return response.chatId;
	};

	const endQuestion = () => {
		forgetHandedOverQuestion(storyId);
		if (hasAttachedStoryChat) {
			void refreshStoryPage();
		}
	};

	return (
		<AskBar
			placeholder={isOwner ? 'Ask a question, edit story' : 'Ask a question about the story'}
			isInputHidden={isInputHidden}
			isAsking={askMutation.isPending}
			hasAskFailed={askMutation.isError}
			resumedQuestion={handedOverQuestion}
			onAsk={askStory}
			onEnd={endQuestion}
		>
			<StoryRefreshAfterEdit />
			{hasAttachedStoryChat && <StoryPageRefreshAfterAnswer onAnswered={refreshStoryPage} />}
		</AskBar>
	);
}

/**
 * The agent may edit the story from a quick question: the page shows the new version once it answered.
 * Only the results of the queries the agent ran are refetched, so the blocks it left alone don't re-query the warehouse.
 */
function StoryRefreshAfterEdit() {
	const queryClient = useQueryClient();
	const messages = useAgentMessages();
	const { isRunning } = useAgentContext();
	const editedStory = isRunning ? false : hasStoryEdit(messages.at(-1));
	const handledMessageId = useRef<string | null>(null);

	useEffect(() => {
		const lastMessage = messages.at(-1);
		if (!editedStory || !lastMessage || handledMessageId.current === lastMessage.id) {
			return;
		}
		handledMessageId.current = lastMessage.id;
		const ranQueryIds = findRanQueryIds(lastMessage);
		queryClient.invalidateQueries({ predicate: (query) => isOutdatedByEdit(query.queryKey, ranQueryIds) });
	}, [editedStory, messages, queryClient]);

	return null;
}

/**
 * Asking about a standalone story attaches a chat to it, which replaces its page by the owned one.
 * The page waits for the answer to end, so the running answer keeps streaming in the panel.
 */
function StoryPageRefreshAfterAnswer({ onAnswered }: { onAnswered: () => void }) {
	const { isRunning } = useAgentContext();
	const wasRunning = useRef(false);

	useEffect(() => {
		if (isRunning) {
			wasRunning.current = true;
			return;
		}
		if (wasRunning.current) {
			wasRunning.current = false;
			onAnswered();
		}
	}, [isRunning, onAnswered]);

	return null;
}

/** Filtered results combine every query of the story, so they only go stale when the agent ran one. */
function isOutdatedByEdit(queryKey: QueryKey, ranQueryIds: Set<string>): boolean {
	const [path, options] = queryKey as [unknown, { input?: { queryId?: unknown; selections?: unknown } } | undefined];
	if (!Array.isArray(path) || !STORY_ROUTERS.has(path[0])) {
		return false;
	}
	const queryId = options?.input?.queryId;
	if (typeof queryId === 'string') {
		return ranQueryIds.has(queryId);
	}
	return options?.input?.selections === undefined || ranQueryIds.size > 0;
}

function findRanQueryIds(message: UIMessage): Set<string> {
	return new Set(
		message.parts.flatMap((part) =>
			(part.type === 'tool-execute_sql' || part.type === 'tool-execute_semantic_query') &&
			part.state === 'output-available'
				? [part.output.id]
				: [],
		),
	);
}

function hasStoryEdit(message: UIMessage | undefined): boolean {
	return (
		message?.role === 'assistant' &&
		message.parts.some((part) => part.type === 'tool-story' && part.state === 'output-available')
	);
}
