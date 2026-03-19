import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { chatActivityStore } from '@/stores/chat-activity';
import { trpc } from '@/main';

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls for backend agents that are still running (e.g. after a browser refresh)
 * and keeps chatActivityStore in sync so the sidebar shows spinners.
 */
export const useActiveAgents = () => {
	const { data: activeChatIds } = useQuery({
		...trpc.chat.activeChats.queryOptions(),
		refetchInterval: (query) => {
			const ids = query.state.data;
			return ids && ids.length > 0 ? POLL_INTERVAL_MS : false;
		},
	});

	useEffect(() => {
		if (!activeChatIds) {
			return;
		}
		for (const chatId of activeChatIds) {
			chatActivityStore.setRunning(chatId, true);
		}
	}, [activeChatIds]);
};
