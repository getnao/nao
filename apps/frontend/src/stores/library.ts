import { Store } from './abstract-store';
import type { LibraryMention } from '@/lib/library';

class LibraryLastItemStore {
	private readonly lastItemIdByChat = new Map<string, string | null>();

	get = (chatId: string) => this.lastItemIdByChat.get(chatId) ?? null;

	set = (chatId: string, itemId: string | null) => {
		this.lastItemIdByChat.set(chatId, itemId);
	};
}

class LibraryMentionRequestStore extends Store<LibraryMention | null> {
	protected state: LibraryMention | null = null;

	request = (mention: LibraryMention) => {
		this.state = mention;
		this.notify();
	};

	consume = () => {
		const mention = this.state;
		this.state = null;
		return mention;
	};

	getSnapshot = () => this.state;
}

export const libraryLastItemStore = new LibraryLastItemStore();
export const libraryMentionRequestStore = new LibraryMentionRequestStore();
