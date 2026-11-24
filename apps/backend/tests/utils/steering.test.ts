import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import type { UIMessage } from '../../src/types/chat';
import { insertSteerMessages, splitSteeredMessages } from '../../src/utils/steering';

const toolCallStep = (toolCallId: string): ModelMessage[] => [
	{ role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'execute_sql', input: {} }] },
	{
		role: 'tool',
		content: [{ type: 'tool-result', toolCallId, toolName: 'execute_sql', output: { type: 'text', value: 'ok' } }],
	},
];

describe('insertSteerMessages', () => {
	it('places each steer right after the results of the tool call it followed', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'Revenue by month' },
			...toolCallStep('call-1'),
			...toolCallStep('call-2'),
		];

		const steered = insertSteerMessages(messages, [
			{ id: 's1', text: 'Only 2026', afterToolCallId: 'call-1' },
			{ id: 's2', text: 'In euros', afterToolCallId: 'call-2' },
		]);

		expect(steered.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'tool',
			'user',
			'assistant',
			'tool',
			'user',
		]);
		expect(steered[3]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Only 2026' }] });
		expect(steered[6]).toEqual({ role: 'user', content: [{ type: 'text', text: 'In euros' }] });
	});

	it('leaves the messages untouched without steers', () => {
		const messages = toolCallStep('call-1');
		expect(insertSteerMessages(messages, [])).toBe(messages);
	});
});

describe('splitSteeredMessages', () => {
	it('splits an assistant message around its steers into the turns the model saw', () => {
		const messages: UIMessage[] = [
			{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Revenue by month' }] },
			{
				id: 'a1',
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'Querying' },
					{ type: 'data-steer', data: { id: 's1', text: 'Only 2026' } },
					{ type: 'step-start' },
					{ type: 'text', text: 'Here is 2026' },
				],
			},
		];

		expect(splitSteeredMessages(messages)).toEqual([
			messages[0],
			{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Querying' }] },
			{ role: 'user', parts: [{ type: 'text', text: 'Only 2026' }] },
			{ id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }, { type: 'text', text: 'Here is 2026' }] },
		]);
	});
});
