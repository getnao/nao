import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { chatActivityStore } from '@/stores/chat-activity';
import { trpc } from '@/main';

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls for backend agents that are still running (e.g. after a browser refresh)
 * and keeps chatActivityStore in sync so the sidebar shows spinners.
 *
 * Also clears running state for agents that have finished between polls,
 * unless the frontend already has its own active stream (managed by useAgent).
 */
export const useActiveAgents = () => {
	const { data: activeChatIds } = useQuery({
		...trpc.chat.activeChats.queryOptions(),
		refetchInterval: (query) => {
			const ids = query.state.data;
			return ids && ids.length > 0 ? POLL_INTERVAL_MS : false;
		},
	});

	const prevIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!activeChatIds) {
			return;
		}

		const currentIds = new Set(activeChatIds);

		for (const chatId of activeChatIds) {
			chatActivityStore.setRunning(chatId, true);
		}

		for (const prevId of prevIdsRef.current) {
			if (!currentIds.has(prevId)) {
				chatActivityStore.setRunning(prevId, false);
			}
		}

		prevIdsRef.current = currentIds;
	}, [activeChatIds]);
};
