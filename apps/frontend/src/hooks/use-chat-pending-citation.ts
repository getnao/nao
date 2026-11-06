import { useSyncExternalStore } from 'react';
import type { ChatPendingCitationStore, PendingCitation } from '@/stores/chat-pending-citation';

const EMPTY: PendingCitation[] = [];

export const useChatPendingCitations = (
	store: ChatPendingCitationStore,
	chatId: string | undefined,
): PendingCitation[] => {
	const pending = useSyncExternalStore(store.subscribe, store.getSnapshot);
	return pending && pending.chatId === chatId ? pending.citations : EMPTY;
};
