import { useCallback, useSyncExternalStore } from 'react';
import { cancellingMessageIdStore } from '@/stores/chat-cancelling-message';

export const useIsCancellingMessage = (messageId: string): boolean => {
	return useSyncExternalStore(
		useCallback((callback) => cancellingMessageIdStore.subscribe(messageId, callback), [messageId]),
		useCallback(() => cancellingMessageIdStore.isCancellingMessage(messageId), [messageId]),
	);
};
