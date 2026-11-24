import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';

import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { trpc } from '@/main';

type MessagesUpdate = (messages: UIMessage[]) => UIMessage[];

/** Spreads a saved query edit to the chat it lives in and to every cached view of its rows and SQL. */
export function usePublishSavedQuery(): (applyUpdate: MessagesUpdate) => void {
	const queryClient = useQueryClient();
	const agent = useOptionalAgentContext();
	const agentRef = useRef(agent);
	agentRef.current = agent;

	return useCallback(
		(applyUpdate: MessagesUpdate) => {
			const currentAgent = agentRef.current;
			if (currentAgent) {
				currentAgent.setMessages((messages) => applyUpdate(messages));
				if (currentAgent.chatId) {
					queryClient.setQueryData(trpc.chat.get.queryKey({ chatId: currentAgent.chatId }), (previous) =>
						previous ? { ...previous, messages: applyUpdate(previous.messages) } : previous,
					);
				}
			}

			queryClient.removeQueries(trpc.chat.getQueryRows.pathFilter());
			void queryClient.invalidateQueries(trpc.story.getQuerySql.pathFilter());
			void queryClient.invalidateQueries(trpc.story.getFilteredQueryData.pathFilter());
			void queryClient.invalidateQueries(trpc.storyShare.getQuerySql.pathFilter());
			void queryClient.invalidateQueries(trpc.storyShare.getFilteredQueryData.pathFilter());
		},
		[queryClient],
	);
}
