import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleChatAnswer } from '../src/services/google-chat-answer';
import type { ToolCallEntry } from '../src/types/messaging-provider';

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

class AdapterRateLimitError extends Error {
	override name = 'AdapterRateLimitError';
}

function createThread() {
	const messages = [
		{ edit: vi.fn(), delete: vi.fn() },
		{ edit: vi.fn(), delete: vi.fn() },
	];
	const post = vi.fn(async () => messages[post.mock.calls.length - 1]);
	return { thread: { id: 'gchat:spaces/AAA', post }, textMessage: messages[0], controlsCard: messages[1] };
}

async function startAnswer() {
	const { thread, textMessage, controlsCard } = createThread();
	const answer = await GoogleChatAnswer.start(thread as never, 'nao');
	return { answer, thread, textMessage, controlsCard };
}

function toolGroup(...types: string[]): Map<string, ToolCallEntry> {
	return new Map(types.map((type, index) => [`call-${index}`, { type, input: {}, toolCallId: `call-${index}` }]));
}

async function settleUpdate(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

describe('GoogleChatAnswer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('posts the answer text first and a Stop card below it', async () => {
		const { thread } = await startAnswer();

		expect(thread.post).toHaveBeenNthCalledWith(1, '✨ nao is answering...');
		expect(thread.post.mock.calls[1][0]).toMatchObject({
			type: 'card',
			children: [{ type: 'actions', children: [{ id: 'stop_generation' }] }],
		});
	});

	it('writes the answer in the syntax Google Chat formats natively', async () => {
		const { answer } = await startAnswer();

		answer.setText('I will check the orders.');
		answer.setToolActivity(toolGroup('tool-grep', 'tool-read', 'tool-read'), true);
		answer.setText(
			'## Summary\nWe have **99 orders**, ~~98~~ __exactly__.\n\n- Source: `orders`\n* See [the chart](https://nao.example/chat)',
		);

		expect(answer.renderText()).toBe(
			[
				'I will check the orders.',
				'_Explored 1 search and 2 files._',
				'**Summary**\nWe have **99 orders**, ~98~ **exactly**.',
				'• Source: `orders`\n• See <https://nao.example/chat|the chart>',
			].join('\n\n'),
		);
	});

	it('keeps headings inside code blocks untouched', async () => {
		const { answer } = await startAnswer();

		answer.setText('```python\n# a comment\n```');

		expect(answer.renderText()).toBe('```python\n# a comment\n```');
	});

	it('updates the streamed text in place until a tool group closes it', async () => {
		const { answer } = await startAnswer();

		answer.setText('Let me');
		answer.setText('Let me look.');
		answer.setToolActivity(toolGroup('tool-grep'), false);
		answer.setToolActivity(toolGroup('tool-grep', 'tool-grep'), true);
		answer.setText('Done.');

		expect(answer.renderText()).toBe('Let me look.\n\n_Explored 2 searches._\n\nDone.');
	});

	it('skips streaming updates that come too soon instead of delaying them', async () => {
		const { answer, textMessage } = await startAnswer();

		answer.setText('First');
		answer.update();
		await settleUpdate();
		answer.setText('First words');
		answer.update();
		await settleUpdate();
		vi.advanceTimersByTime(1500);
		answer.setText('First words, then more');
		answer.update();
		await settleUpdate();

		expect(textMessage.edit.mock.calls).toEqual([[{ raw: 'First' }], [{ raw: 'First words, then more' }]]);
	});

	it('skips a streaming update while the previous one is still being sent', async () => {
		const { answer, textMessage } = await startAnswer();
		let completeEdit: () => void = () => {
			return undefined;
		};
		textMessage.edit.mockImplementationOnce(() => {
			return new Promise<void>((resolve) => {
				completeEdit = resolve;
			});
		});

		answer.setText('First');
		answer.update();
		vi.advanceTimersByTime(5000);
		answer.setText('Second');
		answer.update();
		completeEdit();
		await settleUpdate();

		expect(textMessage.edit).toHaveBeenCalledTimes(1);
	});

	it('never sends empty text, which Google Chat rejects', async () => {
		const { answer, textMessage } = await startAnswer();

		answer.setText('');
		answer.update();
		answer.setText('   ');
		answer.update();
		await settleUpdate();

		expect(textMessage.edit).not.toHaveBeenCalled();
	});

	it('keeps streaming when an update fails, and the final edit still lands', async () => {
		const { answer, textMessage } = await startAnswer();
		textMessage.edit.mockRejectedValueOnce(new Error('Internal error'));

		answer.setText('Partial');
		answer.update();
		await settleUpdate();
		answer.setText('Partial and complete.');
		await answer.finish('https://nao.example/chat');

		expect(textMessage.edit).toHaveBeenLastCalledWith({ raw: 'Partial and complete.' });
	});

	it('shows charts in the card and turns Stop into the feedback buttons when finished', async () => {
		const { answer, controlsCard, textMessage } = await startAnswer();

		answer.setText('Here is the trend.');
		answer.addImage('https://nao.example/c/chat/chart.png');
		await answer.finish('https://nao.example/chat');

		expect(textMessage.edit).toHaveBeenCalledWith({ raw: 'Here is the trend.' });
		expect(controlsCard.delete).not.toHaveBeenCalled();
		const finalCard = controlsCard.edit.mock.calls.at(-1)![0];
		expect(finalCard.children[0]).toMatchObject({ type: 'image', url: 'https://nao.example/c/chat/chart.png' });
		expect(finalCard.children[1].children.map((button: { id?: string }) => button.id)).toEqual([
			undefined,
			'feedback_positive',
			'feedback_negative',
		]);
	});

	it('does not resend unchanged text when only the feedback vote changes', async () => {
		const { answer, textMessage, controlsCard } = await startAnswer();

		answer.setText('Answer.');
		await answer.finish('https://nao.example/chat');
		await answer.finish('https://nao.example/chat', 'up');

		expect(textMessage.edit).toHaveBeenCalledTimes(1);
		expect(controlsCard.edit).toHaveBeenCalledTimes(2);
	});

	it('retries a final edit once when Google Chat rate limits it', async () => {
		const { answer, textMessage } = await startAnswer();
		textMessage.edit.mockRejectedValueOnce(new AdapterRateLimitError('Rate limited by gchat'));

		answer.setText('Final answer.');
		const finishing = answer.finish('https://nao.example/chat');
		await vi.advanceTimersByTimeAsync(2000);
		await finishing;

		expect(textMessage.edit).toHaveBeenCalledTimes(2);
		expect(textMessage.edit).toHaveBeenLastCalledWith({ raw: 'Final answer.' });
	});

	it('keeps only the charts and the nao link on an older answer', async () => {
		const { answer, controlsCard } = await startAnswer();

		answer.addImage('https://nao.example/c/chat/chart.png');
		await answer.retire('https://nao.example/chat');

		const retiredCard = controlsCard.edit.mock.calls.at(-1)![0];
		expect(retiredCard.children).toHaveLength(2);
		expect(retiredCard.children[1].children).toEqual([
			expect.objectContaining({ type: 'link-button', url: 'https://nao.example/chat' }),
		]);
	});

	it('truncates answers longer than a Google Chat message allows', async () => {
		const { answer } = await startAnswer();

		answer.setText('a'.repeat(5000));

		expect(answer.renderText().length).toBeLessThan(4100);
		expect(answer.renderText()).toContain('The full answer is available in nao.');
	});
});
