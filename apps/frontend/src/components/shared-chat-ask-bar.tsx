import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CitationData } from '@nao/shared/types';
import { AskBar } from '@/components/ask-bar';
import { trpc } from '@/main';

/** Asks about a shared chat: each question is a fork of it, so the agent answers knowing the whole conversation. */
export function SharedChatAskBar({ shareId }: { shareId: string }) {
	const queryClient = useQueryClient();
	const askMutation = useMutation(
		trpc.chatFork.askSharedChat.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: trpc.chatFork.listSharedChatQuickQuestions.queryKey({ shareId }),
				}),
		}),
	);

	const askSharedChat = async (citations: CitationData[]) => {
		const { chatId } = await askMutation.mutateAsync({ shareId, selection: toForkSelection(citations) });
		return chatId;
	};

	return (
		<AskBar
			placeholder='Ask a question about this chat'
			isAsking={askMutation.isPending}
			hasAskFailed={askMutation.isError}
			onAsk={askSharedChat}
		/>
	);
}

/** The fork anchors on the first passage quoted from the chat, so the shared chat can show where it was asked. */
function toForkSelection(citations: CitationData[]) {
	const passage = citations.find((citation) => !citation.block);
	return passage && { start: passage.start, end: passage.end, text: passage.text };
}
