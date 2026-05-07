import { useSyncExternalStore } from 'react';
import type { ChatPendingCitationData } from '@/stores/chat-pending-citation';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';

const EMPTY = null;

export const useChatPendingCitation = (chatId: string | undefined): ChatPendingCitationData | null => {
	const citation = useSyncExternalStore(chatPendingCitationStore.subscribe, chatPendingCitationStore.getSnapshot);
	return citation?.chatId === chatId ? citation : EMPTY;
};
