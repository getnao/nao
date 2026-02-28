import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactionLLM } from '../src/agents/compaction/compaction-llm';
import type { ITokenCounter } from '../src/services/token-counter';
import { selectMessagesInBudget } from '../src/utils/ai';

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	generateText: mocks.generateText,
}));

const fakeUsage = {
	inputTokens: 400,
	outputTokens: 100,
	totalTokens: 500,
	inputTokenDetails: { noCacheTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
	outputTokenDetails: { textTokens: 100, reasoningTokens: 0 },
};

describe('selectMessagesInBudget', () => {
	const testTokenCounter: ITokenCounter = {
		estimateMessages: vi.fn((messages: ModelMessage[]) => messages.length * 100),
		estimateTools: vi.fn(async () => 0),
		estimate: vi.fn(() => 0),
	};

	beforeEach(() => {
		vi.mocked(testTokenCounter.estimateMessages).mockImplementation(
			(messages: ModelMessage[]) => messages.length * 100,
		);
	});

	it('returns empty array for empty input', () => {
		expect(selectMessagesInBudget([], 1000, testTokenCounter)).toEqual([]);
	});

	it('returns all messages when they all fit within the budget', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: 'Reply' },
			{ role: 'user', content: 'Second' },
		];
		expect(selectMessagesInBudget(messages, 10_000, testTokenCounter)).toEqual(messages);
	});

	it('drops oldest messages when budget is exceeded', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'First' },
			{ role: 'user', content: 'Second' },
			{ role: 'user', content: 'Third' },
		];
		// Each message costs 100 tokens; budget fits only 2
		const result = selectMessagesInBudget(messages, 250, testTokenCounter);
		expect(result).toEqual([messages[1], messages[2]]);
	});

	it('keeps tool message and its preceding assistant message together', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'run', input: {} }] },
			{
				role: 'tool',
				content: [
					{ type: 'tool-result', toolCallId: '1', toolName: 'run', output: { type: 'text', value: 'ok' } },
				],
			},
			{ role: 'user', content: 'Second' },
		];
		// Budget fits all 4 (4 × 100 = 400 tokens)
		expect(selectMessagesInBudget(messages, 10_000, testTokenCounter)).toEqual(messages);
	});

	it('excludes both tool and assistant messages when the pair exceeds budget', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: '1', toolName: 'run', input: {} }] },
			{
				role: 'tool',
				content: [
					{ type: 'tool-result', toolCallId: '1', toolName: 'run', output: { type: 'text', value: 'ok' } },
				],
			},
			{ role: 'user', content: 'Second' },
		];
		// Budget: 200 → fits last user (100) but not the tool+assistant pair (200 more)
		const result = selectMessagesInBudget(messages, 200, testTokenCounter);
		expect(result).toEqual([messages[3]]);
	});

	it('stops selection when a tool message has no preceding assistant message', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'Old' },
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: '1',
						toolName: 'run',
						output: { type: 'text', value: 'orphan' },
					},
				],
			},
			{ role: 'user', content: 'Current' },
		];
		// Orphan tool message acts as a barrier; only messages before it (in reverse) are kept
		const result = selectMessagesInBudget(messages, 10_000, testTokenCounter);
		expect(result).toEqual([messages[2]]);
	});
});

describe('CompactionLLM', () => {
	const fakeModel = {
		model: { modelId: 'test-model' } as never,
		providerOptions: {},
		contextWindow: 200_000,
	};

	class FakeTokenCounter implements ITokenCounter {
		estimateMessages = vi.fn<(msgs: ModelMessage[]) => number>().mockReturnValue(1_000);
		estimateTools = vi.fn().mockResolvedValue(0);
		estimate = vi.fn<(text: string) => number>().mockReturnValue(0);
	}

	let fakeTokenCounter: FakeTokenCounter;
	let llm: CompactionLLM;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.generateText.mockResolvedValue({ text: 'The summary', usage: fakeUsage });
		fakeTokenCounter = new FakeTokenCounter();
		llm = new CompactionLLM(fakeModel, fakeTokenCounter);
	});

	it('wraps messages with system and user prompts', async () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi' },
		];

		await llm.compact(messages);

		const { messages: sent } = mocks.generateText.mock.calls[0][0];
		expect(sent[0].role).toBe('system');
		expect(sent[sent.length - 1].role).toBe('user');
		expect(sent.slice(1, -1)).toEqual(messages);
	});

	it('returns summary text and usage from generateText', async () => {
		const result = await llm.compact([{ role: 'user', content: 'Question' }]);
		expect(result.summary).toBe('The summary');
		expect(result.usage.totalTokens).toBe(500);
	});

	it('drops overflow messages from the start when budget is exceeded', async () => {
		// Budget = 200_000 - 16_000 - estimateMessages(prefix+suffix)
		// fakeTokenCounter.estimateMessages returns 1_000 → budget = 183_000
		// With estimateMessage returning 100_000 per message, only the last message fits
		fakeTokenCounter.estimateMessages.mockImplementation((messages: ModelMessage[]) => {
			if (messages.length === 2) {
				return 1_000;
			}
			return 100_000;
		});

		const messages: ModelMessage[] = [
			{ role: 'user', content: 'Old 1' },
			{ role: 'user', content: 'Old 2' },
			{ role: 'user', content: 'Recent' },
		];

		await llm.compact(messages);

		const { messages: sent } = mocks.generateText.mock.calls[0][0];
		const body = sent.slice(1, -1); // strip system + user prompts
		expect(body).toHaveLength(1);
		expect(body[0]).toEqual(messages[2]);
	});
});
