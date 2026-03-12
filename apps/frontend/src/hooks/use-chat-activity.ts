import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ChatActivity } from '@/stores/chat-activity';
import { chatActivityStore } from '@/stores/chat-activity';

export const useChatActivity = (chatId: string): ChatActivity => {
	return useSyncExternalStore(
		useCallback((cb) => chatActivityStore.subscribe(chatId, cb), [chatId]),
		useCallback(() => chatActivityStore.getActivity(chatId), [chatId]),
	);
};

export const useSectionActivity = (chatIds: string[]): ChatActivity => {
	const idsKey = chatIds.join(',');

	const subscribe = useCallback(
		(cb: () => void) => {
			const unsubs = chatIds.map((id) => chatActivityStore.subscribe(id, cb));
			return () => unsubs.forEach((unsub) => unsub());
		},
		[idsKey], // eslint-disable-line react-hooks/exhaustive-deps
	);

	const getSnapshot = useCallback(() => {
		let running = false;
		let unread = false;
		for (const id of chatIds) {
			const a = chatActivityStore.getActivity(id);
			if (a.running) running = true;
			if (a.unread) unread = true;
			if (running && unread) break;
		}
		return (running ? 1 : 0) | (unread ? 2 : 0);
	}, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

	const encoded = useSyncExternalStore(subscribe, getSnapshot);
	return useMemo(() => ({ running: (encoded & 1) !== 0, unread: (encoded & 2) !== 0 }), [encoded]);
};
