import { useCallback, useSyncExternalStore } from 'react';
import type { ChatActivity } from '@/stores/chat-activity';
import { chatActivityStore } from '@/stores/chat-activity';

export const useChatActivity = (chatId: string): ChatActivity => {
	return useSyncExternalStore(
		useCallback((cb) => chatActivityStore.subscribe(chatId, cb), [chatId]),
		useCallback(() => chatActivityStore.getActivity(chatId), [chatId]),
	);
};
