import { MAX_CITATIONS_PER_MESSAGE } from '@nao/shared/types';
import { Store } from './abstract-store';
import type { StoryElementCitation } from '@nao/shared/story-app';
import type { CitationData } from '@nao/shared/types';
import { capCitationText, extractCitationIds, isSameCitation, numberCitationTokens } from '@/lib/citation-mention';

export interface PendingCitation extends CitationData {
	id: string;
}

interface CitedStory {
	chatId: string;
	slug: string;
}

interface ChatPendingCitations {
	chatId: string;
	citations: PendingCitation[];
}

export class ChatPendingCitationStore extends Store<ChatPendingCitations | null> {
	protected state: ChatPendingCitations | null = null;

	add = (chatId: string, cited: CitationData) => {
		const citation = capCitationText(cited);
		const citations = this.citationsOf(chatId);
		const isDuplicate = citations.some((pending) => isSameCitation(pending, citation));
		if (isDuplicate || citations.length >= MAX_CITATIONS_PER_MESSAGE) {
			return;
		}
		this.update(chatId, [...citations, withId(citation)]);
	};

	addStoryElement = (chatId: string, story: CitedStory, { block, text, intent }: StoryElementCitation) => {
		this.add(chatId, { storySlug: story.slug, storyChatId: story.chatId, start: 0, end: 0, text, block, intent });
	};

	restore = (chatId: string, citations: CitationData[]): PendingCitation[] => {
		const restored = citations.map(withId);
		this.update(chatId, restored);
		return restored;
	};

	remove = (chatId: string, id: string) => {
		if (this.state?.chatId !== chatId) {
			return;
		}
		this.update(
			chatId,
			this.state.citations.filter((citation) => citation.id !== id),
		);
	};

	clear = (chatId?: string) => {
		if (chatId && this.state?.chatId !== chatId) {
			return;
		}
		this.state = null;
		this.notify();
	};

	getSnapshot = () => this.state;

	private citationsOf(chatId: string): PendingCitation[] {
		return this.state?.chatId === chatId ? this.state.citations : [];
	}

	private update(chatId: string, citations: PendingCitation[]) {
		this.state = citations.length > 0 ? { chatId, citations } : null;
		this.notify();
	}
}

export const chatPendingCitationStore = new ChatPendingCitationStore();

/**
 * The citations whose pill is still in the text, in reading order, with the text numbering them `❝[1]`, `❝[2]`…
 * Only the fields a message carries are kept: a selection can bring along its DOM range, which must not be sent.
 */
export function toMessageCitations(
	pending: PendingCitation[],
	text: string,
): { text: string; citations: CitationData[] } {
	const placed = extractCitationIds(text)
		.map((id) => pending.find((citation) => citation.id === id))
		.filter((citation): citation is PendingCitation => citation !== undefined);
	return {
		text: numberCitationTokens(
			text,
			placed.map((citation) => citation.id),
		),
		citations: placed.map(({ start, end, text: quote, storySlug, storyChatId, block, intent }) => ({
			start,
			end,
			text: quote,
			storySlug,
			storyChatId,
			block,
			intent,
		})),
	};
}

function withId(citation: CitationData): PendingCitation {
	return { ...citation, id: crypto.randomUUID() };
}
