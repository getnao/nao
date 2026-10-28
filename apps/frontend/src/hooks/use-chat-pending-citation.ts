import { useSyncExternalStore } from 'react';
import type { PendingCitation } from '@/stores/chat-pending-citation';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';

const EMPTY: PendingCitation[] = [];

export const useChatPendingCitations = (chatId: string | undefined): PendingCitation[] => {
	const pending = useSyncExternalStore(chatPendingCitationStore.subscribe, chatPendingCitationStore.getSnapshot);
	return pending && pending.chatId === chatId ? pending.citations : EMPTY;
};
