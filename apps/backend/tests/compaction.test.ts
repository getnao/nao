import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProviderModel } from '../src/agents/providers';
import { CompactionService } from '../src/services/compaction';
import type { ITokenCounter } from '../src/services/token-counter';
import type { AgentTools, UIMessage } from '../src/types/chat';

const mocks = vi.hoisted(() => ({
	compactMock: vi.fn(),
	resolveProviderModelMock: vi.fn(),
	resolveAnnotationModelIdMock: vi.fn(),
	resolveDefaultModelSelectionMock: vi.fn(),
	scheduleSaveMock: vi.fn(),
}));

vi.mock('../src/utils/llm', () => ({
	resolveProviderModel: mocks.resolveProviderModelMock,
	resolveAnnotationModelId: mocks.resolveAnnotationModelIdMock,
	resolveDefaultModelSelection: mocks.resolveDefaultModelSelectionMock,
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
		mocks.resolveProviderModelMock.mockResolvedValue({
			model: { modelId: 'gpt-4.1-mini' },
			providerOptions: { openai: {} },
			contextWindow: 200_000,
		});
		mocks.resolveAnnotationModelIdMock.mockResolvedValue('gpt-4.1-mini');
		mocks.resolveDefaultModelSelectionMock.mockResolvedValue(null);
		mocks.compactMock.mockResolvedValue({
			summary: 'Conversation summary',
			usage: { totalTokens: 123 },
		});
		tokenCounter.estimateMessages.mockImplementation((msgs: ModelMessage[]) => msgs.length * 6_000);
		tokenCounter.estimateTools.mockResolvedValue(0);
	});

	it.each([
		'global.openai.gpt-6-astra',
		'global.openai.gpt-6.1-sol',
		'global.openai.gpt-6-sol',
		'global.openai.gpt-6-luna',
		'us.openai.gpt-6-astra',
		'us.openai.gpt-6.1-sol',
		'us.openai.gpt-6-sol',
		'us.openai.gpt-6-luna',
	])('uses the catalog window to compact %s only above 787,500 total tokens', async (modelId) => {
		const { contextWindow } = createProviderModel('bedrock', { apiKey: 'test-key' }, modelId);
		// Include tool definitions and reserved output in the real service's threshold calculation.
		tokenCounter.estimateTools.mockResolvedValue(1_000);
		const maxOutputTokens = 1_000;

		for (const messageTokens of [200_000, 785_500, 785_501]) {
			vi.clearAllMocks();
			tokenCounter.estimateMessages.mockReturnValue(messageTokens);
			const messages: ModelMessage[] = [
				{ role: 'system', content: 'System prompt' },
				{ role: 'user', content: 'First question' },
				{ role: 'assistant', content: 'First answer' },
				{ role: 'user', content: 'Current turn' },
			];
			const result = await compactionService.compactConversationIfNeeded({
				chat: { id: 'chat-gpt6', projectId: 'project-1', userId: 'user-1' },
				provider: 'bedrock',
				modelId,
				messages,
				tools: {},
				maxOutputTokens,
				contextWindow,
				onCompactionStarted,
				onCompactionFinished,
			});

			if (messageTokens === 785_501) {
				expect(result).toMatchObject({ summary: 'Conversation summary' });
				expect(onCompactionStarted).toHaveBeenCalledOnce();
				expect(onCompactionFinished).toHaveBeenCalledOnce();
				expect(mocks.compactMock).toHaveBeenCalledOnce();
			} else {
				expect(result).toBeUndefined();
				expect(onCompactionStarted).not.toHaveBeenCalled();
				expect(onCompactionFinished).not.toHaveBeenCalled();
				expect(mocks.compactMock).not.toHaveBeenCalled();
			}
		}
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
			modelId: 'gpt-5.5',
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
			modelId: 'gpt-5.5',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 60_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(onCompactionStarted).toHaveBeenCalledOnce();
		expect(onCompactionFinished).toHaveBeenCalledOnce();
		expect(mocks.resolveAnnotationModelIdMock).toHaveBeenCalledWith(
			'project-2',
			{ provider: 'openai', modelId: 'gpt-5.5' },
			'gpt-4.1-mini',
		);

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

	it('sanitizes tool call ids for the compaction provider, not the chat provider', async () => {
		tokenCounter.estimateMessages.mockReturnValue(80_000);
		mocks.resolveDefaultModelSelectionMock.mockResolvedValue({
			provider: 'anthropic',
			modelId: 'claude-haiku-4-5',
		});
		const geminiToolCallId = 'call_9f2c4e7a1b3d__thought__EsIHCr8HAWkUfRNYSIYIhfhBJbAiEyioV+a1b2/c3d4==';

		const messages: ModelMessage[] = [
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'First question' },
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: geminiToolCallId, toolName: 'execute_sql', input: {} }],
			},
			{ role: 'user', content: 'Current turn' },
		];

		await compactionService.compactConversationIfNeeded({
			chat: { id: 'chat-3', projectId: 'project-3', userId: 'user-3' },
			provider: 'openaiCompatible/litellm',
			modelId: 'gemini-3.1-pro-preview',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 60_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		const [summarizedMessages] = mocks.compactMock.mock.calls[0];
		expect(summarizedMessages[1].content[0].toolCallId).toBe('call_9f2c4e7a1b3d');
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

	it('ignores a persisted compaction with an empty summary and falls back to the last real one', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'First question' }] },
			{
				id: '2',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: 'Real summary' } },
					{ type: 'text', text: 'Real answer' },
				],
			},
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Second question' }] },
			{
				id: '4',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: '' } },
					{ type: 'text', text: 'Follow-up answer' },
				],
			},
			{ id: '5', role: 'user', parts: [{ type: 'text', text: 'Third question' }] },
		];

		const result = compactionService.useLastCompaction(messages);

		expect(result[0]).toEqual({
			role: 'assistant',
			parts: [{ type: 'text', text: 'Real summary' }],
		});
		expect(result).toHaveLength(6);
	});

	it('tolerates a null summary from a legacy DB row and skips it', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Question' }] },
			{
				id: '2',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: null as unknown as string } },
					{ type: 'text', text: 'Answer' },
				],
			},
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Next question' }] },
		];

		const result = compactionService.useLastCompaction(messages);
		expect(result).toBe(messages);
	});

	it('returns messages unchanged when the only compaction has a blank summary', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Question' }] },
			{
				id: '2',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: '   ' } },
					{ type: 'text', text: 'Answer' },
				],
			},
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Next question' }] },
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
