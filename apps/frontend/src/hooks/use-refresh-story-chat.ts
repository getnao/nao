import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { Query } from '@tanstack/react-query';
import type { UIToolPart } from '@nao/backend/chat';

/**
 * A story edited from another chat keeps its versions in its own chat: once the edit lands, every cached query of
 * that chat (its messages, versions and content) is refreshed so an open viewer shows the new version.
 */
export function useRefreshStoryChat(toolPart: UIToolPart<'story'>) {
	const queryClient = useQueryClient();
	const wasPendingOnMountRef = useRef(toolPart.state !== 'output-available');
	const storyChatId = toolPart.output?.success ? toolPart.output.story_chat_id : undefined;

	useEffect(() => {
		if (!wasPendingOnMountRef.current || !storyChatId) {
			return;
		}
		wasPendingOnMountRef.current = false;
		void queryClient.invalidateQueries({ predicate: (query) => readsChat(query, storyChatId) });
	}, [queryClient, storyChatId]);
}

function readsChat(query: Query, chatId: string): boolean {
	const [, options] = query.queryKey as [unknown, { input?: { chatId?: unknown } } | undefined];
	return options?.input?.chatId === chatId;
}
