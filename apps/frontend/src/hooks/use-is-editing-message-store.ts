import { useSyncExternalStore } from 'react';
import { editedMessageIdStore } from '@/stores/chat-edited-message';

export const useIsEditingMessage = (messageId: string): boolean => {
	return useSyncExternalStore(
		(callback) => editedMessageIdStore.subscribe(messageId, callback),
		() => editedMessageIdStore.isEditingMessage(messageId),
	);
};
