import { useSyncExternalStore } from 'react';
import type { QueuedMessage } from '@/types/chat-message-queue';
import { messageQueueStore } from '@/stores/chat-message-queue';

// Stable empty array to avoid infinite re-rendering when the queue is empty.
const EMPTY_ARRAY: QueuedMessage[] = [];

interface UseMessageQueueStoreHelpers {
	queuedMessages: QueuedMessage[];
}

export const useMessageQueueStore = (chatId: string | undefined): UseMessageQueueStoreHelpers => {
	const queuedMessages = useSyncExternalStore(
		messageQueueStore.subscribe,
		() => messageQueueStore.getSnapshot(chatId) ?? EMPTY_ARRAY,
	);

	return {
		queuedMessages,
	};
};
