import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;

const createMessageEditStore = () => {
	let editingId: string | null = null;
	const listeners = new Map<string, Set<Listener>>();

	const notify = (messageId: string | null) => {
		if (messageId !== null) {
			listeners.get(messageId)?.forEach((fn) => fn());
		}
	};

	return {
		setEditing: (id: string | null) => {
			const prev = editingId;
			editingId = id;
			notify(prev);
			notify(id);
		},
		subscribe: (messageId: string, callback: Listener) => {
			if (!listeners.has(messageId)) {
				listeners.set(messageId, new Set());
			}
			listeners.get(messageId)!.add(callback);
			return () => {
				const messageListeners = listeners.get(messageId);
				if (!messageListeners) {
					return;
				}
				messageListeners.delete(callback);
				if (messageListeners.size === 0) {
					listeners.delete(messageId);
				}
			};
		},
		getSnapshot: (messageId: string): boolean => editingId === messageId,
	};
};

export const messageEditStore = createMessageEditStore();

export const useIsEditingMessage = (messageId: string): boolean => {
	return useSyncExternalStore(
		useCallback(
			(callback: Listener) => {
				return messageEditStore.subscribe(messageId, callback);
			},
			[messageId],
		),
		useCallback(() => {
			return messageEditStore.getSnapshot(messageId);
		}, [messageId]),
	);
};
