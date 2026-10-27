import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import type { AskSelection } from '@/stores/ask-bar';
import { AskBar } from '@/components/ask-bar';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { trpc } from '@/main';
import { forgetHandedOverQuestion, getHandedOverQuestion, handOverQuestion } from '@/stores/ask-bar';

const STORY_QUERY_KEYS = [[['story']], [['storyShare']], [['customStoryViewer']]];
const MAX_SELECTION_TEXT_LENGTH = 4_000;

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
	const askMutation = useMutation(trpc.chatFork.askStory.mutationOptions());

	useEffect(() => {
		forgetHandedOverQuestion(storyId);
	}, [storyId]);

	const askStory = async (selection?: AskSelection) => {
		const { chatId, hasAttachedStoryChat } = await askMutation.mutateAsync({
			storyId,
			selectionText: selection && toSelectionText(selection).slice(0, MAX_SELECTION_TEXT_LENGTH),
		});
		if (hasAttachedStoryChat) {
			handOverQuestion(storyId, { chatId, selection });
		}
		return chatId;
	};

	return (
		<AskBar
			placeholder={isOwner ? 'Ask a question, edit story' : 'Ask a question about the story'}
			isInputHidden={isInputHidden}
			isAsking={askMutation.isPending}
			hasAskFailed={askMutation.isError}
			resumedQuestion={handedOverQuestion}
			onAsk={askStory}
			onEnd={() => forgetHandedOverQuestion(storyId)}
		>
			<StoryRefreshAfterEdit />
		</AskBar>
	);
}

/** The agent may edit the story from a quick question: the page shows the new version once it answered. */
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
		for (const queryKey of STORY_QUERY_KEYS) {
			queryClient.invalidateQueries({ queryKey });
		}
	}, [editedStory, messages, queryClient]);

	return null;
}

function hasStoryEdit(message: UIMessage | undefined): boolean {
	return (
		message?.role === 'assistant' &&
		message.parts.some((part) => part.type === 'tool-story' && part.state === 'output-available')
	);
}

/** What the agent reads about the selection: the selected text, or the block of a custom story. */
function toSelectionText({ text, block }: AskSelection): string {
	if (!block) {
		return text;
	}
	return block.title ? `The ${block.kind} "${block.title}"` : `This ${block.kind}`;
}
