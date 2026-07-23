import { useSyncExternalStore } from 'react';
import { SelectorStore } from './abstract-store';
import type { CitationData } from '@nao/shared/types';

export type ChatInputRestore = {
	text: string;
	images: { url: string; mediaType: string }[];
	citation?: CitationData;
};

const RESTORE_KEY = 'restore';

class ChatInputRestoreStore extends SelectorStore<ChatInputRestore | undefined> {
	protected state: ChatInputRestore | undefined = undefined;

	set = (payload: ChatInputRestore) => {
		this.state = payload;
		this.notify(RESTORE_KEY);
	};

	clear = () => {
		if (!this.state) {
			return;
		}
		this.state = undefined;
		this.notify(RESTORE_KEY);
	};

	getSnapshot = () => this.state;

	subscribeToRestore = (callback: () => void) => this.subscribe(RESTORE_KEY, callback);
}

export const chatInputRestoreStore = new ChatInputRestoreStore();

export const useChatInputRestore = (enabled: boolean) =>
	useSyncExternalStore(
		enabled ? chatInputRestoreStore.subscribeToRestore : subscribeNoop,
		enabled ? chatInputRestoreStore.getSnapshot : getEmptySnapshot,
	);

const subscribeNoop = () => () => {};
const getEmptySnapshot = () => undefined;
