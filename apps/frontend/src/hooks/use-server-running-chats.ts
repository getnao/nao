import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { trpc } from '@/main';
import { agentService } from '@/services/agents';
import { chatActivityStore } from '@/stores/chat-activity';

const POLL_WHILE_RUNNING_MS = 3_000;
const POLL_WHILE_IDLE_MS = 30_000;

/**
 * Shows the chats the server runs an agent for as running, including the ones started before a reload or
 * in another tab, which have no agent in this tab to say so. A chat with an agent here is left to it.
 */
export const useServerRunningChats = (enabled: boolean) => {
	const queryClient = useQueryClient();
	const openChatIdRef = useRef<string | undefined>(undefined);
	openChatIdRef.current = useParams({ strict: false }).chatId;
	const previousRunningChatIdsRef = useRef<string[]>([]);
	const { data: runningChatIds } = useQuery({
		...trpc.chat.listRunning.queryOptions(),
		enabled,
		refetchInterval: (query) => (query.state.data?.length ? POLL_WHILE_RUNNING_MS : POLL_WHILE_IDLE_MS),
	});

	useEffect(() => {
		if (!runningChatIds) {
			return;
		}

		const finishedChatIds = previousRunningChatIdsRef.current.filter((chatId) => !runningChatIds.includes(chatId));
		previousRunningChatIdsRef.current = runningChatIds;
		runningChatIds.filter(hasNoAgentInThisTab).forEach((chatId) => chatActivityStore.setRunning(chatId, true));

		const finishedElsewhere = finishedChatIds.filter(hasNoAgentInThisTab);
		finishedElsewhere.forEach((chatId) => {
			chatActivityStore.setRunning(chatId, false);
			if (chatId !== openChatIdRef.current) {
				chatActivityStore.setUnread(chatId, true);
			}
		});
		if (finishedElsewhere.length > 0) {
			queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
		}
	}, [runningChatIds, queryClient]);
};

function hasNoAgentInThisTab(chatId: string): boolean {
	return !agentService.getAgent(chatId);
}
