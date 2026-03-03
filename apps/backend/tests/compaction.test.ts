import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactionService } from '../src/services/compaction';
import type { ITokenCounter } from '../src/services/token-counter';
import type { AgentTools, UIMessage } from '../src/types/chat';

const mocks = vi.hoisted(() => ({
	compactMock: vi.fn(),
	resolveProviderModelMock: vi.fn(),
	scheduleSaveMock: vi.fn(),
}));

vi.mock('../src/utils/llm', () => ({
	resolveProviderModel: mocks.resolveProviderModelMock,
}));

vi.mock('../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: mocks.scheduleSaveMock,
}));

class FakeTokenCounter implements ITokenCounter {
	estimateMessages = vi.fn<(messages: ModelMessage[]) => number>();
	estimateTools = vi.fn<(tools: AgentTools) => Promise<number>>();
	estimate = vi.fn<(text: string) => number>();
}

const onCompactionStarted = vi.fn();
const onCompactionFinished = vi.fn();

describe('compactionService.compactConversationIfNeeded', () => {
	let compactionService: CompactionService;
	let tokenCounter: FakeTokenCounter;

	beforeEach(() => {
		vi.clearAllMocks();
		tokenCounter = new FakeTokenCounter();
		compactionService = new CompactionService({
			createCompactionLlm: () => ({
				modelId: 'gpt-4.1-mini',
				compact: mocks.compactMock,
			}),
			tokenCounter,
		});
		mocks.resolveProviderModelMock.mockResolvedValue({ model: {} });
		mocks.compactMock.mockResolvedValue({
			summary: 'Conversation summary',
			usage: { totalTokens: 123 },
		});
		tokenCounter.estimateMessages.mockImplementation((msgs: ModelMessage[]) => msgs.length * 6_000);
		tokenCounter.estimateTools.mockResolvedValue(0);
	});

	it('returns undefined when token usage is below threshold', async () => {
		tokenCounter.estimateMessages.mockReturnValue(10);

		const messages: ModelMessage[] = [
			{ role: 'system', content: 'You are helpful.' },
			{ role: 'user', content: 'Hi' },
		];

		const result = await compactionService.compactConversationIfNeeded({
			chat: { id: 'chat-1', projectId: 'project-1', userId: 'user-1' },
			provider: 'openai',
			messages,
			tools: {},
			maxOutputTokens: 16,
			contextWindow: 10_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(result).toBeUndefined();
		expect(onCompactionStarted).not.toHaveBeenCalled();
		expect(onCompactionFinished).not.toHaveBeenCalled();
		expect(mocks.compactMock).not.toHaveBeenCalled();
	});

	it('summarizes history before the current turn and replaces it with a summary message', async () => {
		tokenCounter.estimateMessages.mockImplementation((msgs: ModelMessage[]) => {
			if (msgs.length === 4) {
				return 80_000;
			}
			return 1_000;
		});

		const messages: ModelMessage[] = [
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'First question' },
			{ role: 'assistant', content: 'First answer' },
			{ role: 'user', content: 'Current turn' },
		];

		const result = await compactionService.compactConversationIfNeeded({
			chat: { id: 'chat-2', projectId: 'project-2', userId: 'user-2' },
			provider: 'openai',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 60_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(onCompactionStarted).toHaveBeenCalledOnce();
		expect(onCompactionFinished).toHaveBeenCalledOnce();

		expect(result).toMatchObject({
			summary: 'Conversation summary',
		});

		expect(mocks.compactMock).toHaveBeenCalledWith([
			{ role: 'user', content: 'First question' },
			{ role: 'assistant', content: 'First answer' },
		]);

		expect(messages).toHaveLength(3);
		expect(messages[0]).toEqual({ role: 'system', content: 'System prompt' });
		expect(messages[1]).toEqual(
			expect.objectContaining({ role: 'assistant', content: expect.stringContaining('Conversation summary') }),
		);
		expect(messages[2]).toEqual({ role: 'user', content: 'Current turn' });
	});
});

describe('compactionService.useLastCompaction', () => {
	const compactionService = new CompactionService({
		createCompactionLlm: () => ({
			modelId: 'gpt-4.1-mini',
			compact: mocks.compactMock,
		}),
		tokenCounter: new FakeTokenCounter(),
	});

	it('returns messages unchanged when no compaction exists', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
			{ id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] },
		];

		const result = compactionService.useLastCompaction(messages);
		expect(result).toBe(messages);
	});

	it('reconstructs compaction as [SUMMARY, remaining messages from last user turn]', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Old question' }] },
			{ id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Old answer' }] },
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Current question' }] },
			{
				id: '4',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: 'History summary' } },
					{ type: 'text', text: 'Response' },
				],
			},
			{ id: '5', role: 'user', parts: [{ type: 'text', text: 'New question' }] },
		];

		const result = compactionService.useLastCompaction(messages);

		expect(result[0]).toEqual({
			role: 'assistant',
			parts: [{ type: 'text', text: 'History summary' }],
		});
		expect(result[1]).toEqual(messages[2]);
		expect(result[2]).toEqual(messages[3]);
		expect(result[3]).toEqual(messages[4]);
		expect(result).toHaveLength(4);
	});
});
