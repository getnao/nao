import { Store } from './abstract-store';
import type { CitationData } from '@nao/shared/types';

export interface ChatPendingCitationData extends CitationData {
	chatId: string;
}

class ChatPendingCitationStore extends Store<ChatPendingCitationData | null> {
	protected state: ChatPendingCitationData | null = null;

	set = (citation: ChatPendingCitationData) => {
		this.state = citation;
		this.notify();
	};

	clear = (chatId?: string) => {
		if (chatId && this.state?.chatId !== chatId) {
			return;
		}
		this.state = null;
		this.notify();
	};

	getSnapshot = () => this.state;
}

export const chatPendingCitationStore = new ChatPendingCitationStore();
