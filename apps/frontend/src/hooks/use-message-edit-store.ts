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
				listeners.get(messageId)!.delete(callback);
			};
		},
		getSnapshot: (messageId: string): boolean => editingId === messageId,
	};
};

export const messageEditStore = createMessageEditStore();

export const useIsEditingMessage = (messageId: string): boolean => {
	const subscribe = useCallback((callback: Listener) => messageEditStore.subscribe(messageId, callback), [messageId]);
	const getSnapshot = useCallback(() => messageEditStore.getSnapshot(messageId), [messageId]);
	return useSyncExternalStore(subscribe, getSnapshot);
};
