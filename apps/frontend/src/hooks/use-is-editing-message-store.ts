import { useCallback, useSyncExternalStore } from 'react';
import { editedMessageIdStore } from '@/stores/chat-edited-message';

export const useIsEditingMessage = (messageId: string): boolean => {
	return useSyncExternalStore(
		useCallback((callback) => editedMessageIdStore.subscribe(messageId, callback), [messageId]),
		useCallback(() => editedMessageIdStore.isEditingMessage(messageId), [messageId]),
	);
};
