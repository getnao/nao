import { describe, expect, it } from 'vitest';
import { messageQueueStore } from '@/stores/chat-message-queue';

const message = (text: string, steer?: boolean) => ({ text, mentions: [], steer });
const texts = (chatId: string) => messageQueueStore.getSnapshot(chatId)?.map((m) => `${m.text}${m.steer ? '*' : ''}`);

describe('steering in the message queue', () => {
	it('puts steers ahead of queued messages so a missed steer is sent next', () => {
		messageQueueStore.enqueue('chat-a', message('later'));
		messageQueueStore.enqueue('chat-a', message('first steer', true));
		messageQueueStore.enqueue('chat-a', message('second steer', true));

		expect(texts('chat-a')).toEqual(['first steer*', 'second steer*', 'later']);
	});

	it('steers a queued message and turns missed steers back into queued messages', () => {
		messageQueueStore.enqueue('chat-b', message('one'));
		const two = messageQueueStore.enqueue('chat-b', message('two'))!;

		messageQueueStore.steer('chat-b', two.id);
		expect(texts('chat-b')).toEqual(['two*', 'one']);

		messageQueueStore.unsteer('chat-b');
		expect(texts('chat-b')).toEqual(['two', 'one']);
	});
});
