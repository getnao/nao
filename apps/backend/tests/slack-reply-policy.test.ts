import { describe, expect, it } from 'vitest';

import { shouldReplyToSlackThreadMessage } from '../src/utils/slack-reply-policy';

describe('shouldReplyToSlackThreadMessage', () => {
	it('allows user thread replies in thread mode', () => {
		expect(shouldReplyToSlackThreadMessage('thread', createMessage())).toBe(true);
	});

	it('does not allow ordinary thread replies in mention mode', () => {
		expect(shouldReplyToSlackThreadMessage('mention', createMessage())).toBe(false);
	});

	it('allows mention messages in thread mode', () => {
		expect(shouldReplyToSlackThreadMessage('thread', createMessage({ isMention: true }))).toBe(true);
	});

	it('does not allow bot or self messages', () => {
		expect(shouldReplyToSlackThreadMessage('thread', createMessage({ isBot: true }))).toBe(false);
		expect(shouldReplyToSlackThreadMessage('thread', createMessage({ isMe: true }))).toBe(false);
	});
});

function createMessage(overrides: { isMention?: boolean; isBot?: boolean; isMe?: boolean } = {}) {
	return {
		isMention: overrides.isMention ?? false,
		author: {
			isBot: overrides.isBot ?? false,
			isMe: overrides.isMe ?? false,
		},
	};
}
