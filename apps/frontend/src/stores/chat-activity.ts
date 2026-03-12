import { SelectorStore } from './abstract-store';

export interface ChatActivity {
	running: boolean;
	unread: boolean;
}

const DEFAULT_ACTIVITY: ChatActivity = { running: false, unread: false };

class ChatActivityStore extends SelectorStore<Map<string, ChatActivity>> {
	protected state = new Map<string, ChatActivity>();

	setRunning(chatId: string, running: boolean) {
		const current = this.state.get(chatId);
		if ((current?.running ?? false) === running) {
			return;
		}

		const next = { ...(current ?? DEFAULT_ACTIVITY), running };
		if (!next.running && !next.unread) {
			this.state.delete(chatId);
		} else {
			this.state.set(chatId, next);
		}
		this.notify(chatId);
	}

	setUnread(chatId: string, unread: boolean) {
		const current = this.state.get(chatId);
		if ((current?.unread ?? false) === unread) {
			return;
		}

		const next = { ...(current ?? DEFAULT_ACTIVITY), unread };
		if (!next.running && !next.unread) {
			this.state.delete(chatId);
		} else {
			this.state.set(chatId, next);
		}
		this.notify(chatId);
	}

	getActivity(chatId: string): ChatActivity {
		return this.state.get(chatId) ?? DEFAULT_ACTIVITY;
	}
}

export const chatActivityStore = new ChatActivityStore();
