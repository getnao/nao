import { Store } from './abstract-store';
import type { CitationData, StoryBlockReference } from '@nao/shared/types';

export interface ChatPendingCitationData extends CitationData {
	chatId: string;
}

class ChatPendingCitationStore extends Store<ChatPendingCitationData | null> {
	protected state: ChatPendingCitationData | null = null;

	set = (citation: ChatPendingCitationData) => {
		this.state = citation;
		this.notify();
	};

	setBlock = (chatId: string, storySlug: string, block: StoryBlockReference) => {
		this.set({ chatId, storySlug, start: 0, end: 0, text: block.title ?? '', block });
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
