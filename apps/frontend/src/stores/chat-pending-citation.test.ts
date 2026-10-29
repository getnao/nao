import { afterEach, describe, expect, it } from 'vitest';

import { chatPendingCitationStore, toMessageCitations } from './chat-pending-citation';

const CHART = { kind: 'bar-chart', title: 'Revenue', queryId: 'q1' };
const STORY = { chatId: 'story-chat', slug: 'story' };

describe('chat pending citations', () => {
	afterEach(() => chatPendingCitationStore.clear());

	it('keeps each cited element once, in the order it was asked about', () => {
		chatPendingCitationStore.addStoryElement('chat', STORY, { block: CHART, text: 'Revenue', intent: 'ask' });
		chatPendingCitationStore.add('chat', { start: 3, end: 8, text: 'March' });
		chatPendingCitationStore.addStoryElement('chat', STORY, { block: CHART, text: 'Revenue', intent: 'ask' });

		expect(citations().map((citation) => citation.text)).toEqual(['Revenue', 'March']);
	});

	it('sends the chat of the cited story, which can differ from the chat quoting it', () => {
		chatPendingCitationStore.addStoryElement('chat', STORY, { block: CHART, text: 'Revenue', intent: 'ask' });
		const [cited] = citations();

		const message = toMessageCitations(citations(), `why ❝[${cited.id}]?`);

		expect(message.citations).toEqual([
			{ start: 0, end: 0, text: 'Revenue', storySlug: 'story', storyChatId: 'story-chat', block: CHART, intent: 'ask' },
		]);
	});

	it('starts a new list when another chat cites something', () => {
		chatPendingCitationStore.add('chat', { start: 0, end: 5, text: 'first' });
		chatPendingCitationStore.add('other', { start: 0, end: 6, text: 'second' });

		expect(chatPendingCitationStore.getSnapshot()?.chatId).toBe('other');
		expect(citations().map((citation) => citation.text)).toEqual(['second']);
	});

	it('sends the citations whose pill is still in the text, numbered in reading order', () => {
		const range = {} as Range;
		chatPendingCitationStore.add('chat', { start: 0, end: 5, text: 'first', range } as never);
		chatPendingCitationStore.add('chat', { start: 6, end: 12, text: 'second' });
		chatPendingCitationStore.add('chat', { start: 13, end: 18, text: 'third' });
		const [first, second, third] = citations();

		const message = toMessageCitations(citations(), `why ❝[${third.id}] when ❝[${first.id}]?`);

		expect(second).toBeDefined();
		expect(message).toEqual({
			text: 'why ❝[1] when ❝[2]?',
			citations: [
				{ start: 13, end: 18, text: 'third' },
				{ start: 0, end: 5, text: 'first' },
			],
		});
	});
});

function citations() {
	return chatPendingCitationStore.getSnapshot()?.citations ?? [];
}
