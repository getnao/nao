import type { ModelMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentTools, UIMessage } from '../src/types/chat';

const mocks = vi.hoisted(() => ({
	compactMock: vi.fn(),
	resolveProviderModelMock: vi.fn(),
	scheduleSaveMock: vi.fn(),
	estimateMessagesTokensMock: vi.fn(),
	estimateMessageTokensMock: vi.fn(),
	estimateToolsTokensMock: vi.fn(),
	findLastUserMessageMock: vi.fn(),
}));

vi.mock('../src/utils/llm', () => ({
	resolveProviderModel: mocks.resolveProviderModelMock,
}));

vi.mock('../src/utils/schedule-task', () => ({
	scheduleSaveLlmInferenceRecord: mocks.scheduleSaveMock,
}));

vi.mock('../src/utils/ai', () => ({
	estimateMessagesTokens: mocks.estimateMessagesTokensMock,
	estimateMessageTokens: mocks.estimateMessageTokensMock,
	estimateToolsTokens: mocks.estimateToolsTokensMock,
	findLastUserMessage: mocks.findLastUserMessageMock,
}));

import { CompactionService } from '../src/services/compaction.service';

describe('compactionService.compactConversationIfNeeded', () => {
	let compactionService: CompactionService;

	beforeEach(() => {
		vi.clearAllMocks();
		compactionService = new CompactionService({
			createCompactionLlm: () => ({ compact: mocks.compactMock }),
		});
		mocks.resolveProviderModelMock.mockResolvedValue({ model: {} });
		mocks.compactMock.mockResolvedValue({
			summary: 'Conversation summary',
			usage: { totalTokens: 123 },
		});
		mocks.estimateMessagesTokensMock.mockImplementation((msgs: ModelMessage[]) => msgs.length * 20_000);
		mocks.estimateMessageTokensMock.mockReturnValue(2_000);
		mocks.estimateToolsTokensMock.mockResolvedValue(0);
		mocks.findLastUserMessageMock.mockReturnValue([undefined, undefined]);
	});

	it('returns undefined when token usage is below threshold', async () => {
		mocks.estimateMessagesTokensMock.mockReturnValue(10);

		const messages: ModelMessage[] = [
			{ role: 'system', content: 'You are helpful.' },
			{ role: 'user', content: 'Hi' },
		];
		const onCompactionStarted = vi.fn();
		const onCompactionFinished = vi.fn();

		const result = await compactionService.compactConversationIfNeeded({
			chatId: 'chat-1',
			projectId: 'project-1',
			userId: 'user-1',
			provider: 'openai',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 16,
			contextWindow: 10_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(result).toBeUndefined();
		expect(onCompactionStarted).not.toHaveBeenCalled();
		expect(onCompactionFinished).not.toHaveBeenCalled();
		expect(mocks.resolveProviderModelMock).not.toHaveBeenCalled();
		expect(mocks.compactMock).not.toHaveBeenCalled();
	});

	it('case 1: history compaction when current turn fits after summarizing history', async () => {
		const messages: ModelMessage[] = [
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'First question with some extra text to increase token estimate.' },
			{ role: 'assistant', content: 'First answer with some extra text to increase token estimate.' },
			{ role: 'user', content: 'Current turn' },
		];
		const onCompactionStarted = vi.fn();
		const onCompactionFinished = vi.fn();

		const result = await compactionService.compactConversationIfNeeded({
			chatId: 'chat-2',
			projectId: 'project-2',
			userId: 'user-2',
			provider: 'openai',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 100_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(onCompactionStarted).toHaveBeenCalledOnce();
		expect(onCompactionFinished).toHaveBeenCalledWith({ summary: 'Conversation summary', summaryType: 'partial' });
		expect(result).toEqual({ summary: 'Conversation summary', summaryType: 'partial' });

		expect(mocks.resolveProviderModelMock).toHaveBeenCalledWith('project-2', 'openai', 'gpt-4.1-mini');
		expect(mocks.compactMock).toHaveBeenCalledWith([
			{ role: 'user', content: 'First question with some extra text to increase token estimate.' },
			{ role: 'assistant', content: 'First answer with some extra text to increase token estimate.' },
		]);

		expect(messages).toEqual([
			{ role: 'system', content: 'System prompt' },
			{ role: 'assistant', content: 'Conversation summary' },
			{ role: 'user', content: 'Current turn' },
		]);

		expect(mocks.scheduleSaveMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'compaction',
				projectId: 'project-2',
				userId: 'user-2',
				chatId: 'chat-2',
				llmProvider: 'openai',
				llmModelId: 'gpt-4.1-mini',
			}),
		);
	});

	it('case 2: turn compaction when current turn is too large for history-only compaction', async () => {
		const messages: ModelMessage[] = [
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'Current turn question' },
			{ role: 'assistant', content: 'Tool call 1 result' },
			{ role: 'assistant', content: 'Tool call 2 result' },
			{ role: 'assistant', content: 'Tool call 3 result' },
		];
		const onCompactionStarted = vi.fn();
		const onCompactionFinished = vi.fn();

		const result = await compactionService.compactConversationIfNeeded({
			chatId: 'chat-3',
			projectId: 'project-3',
			userId: 'user-3',
			provider: 'openai',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 30_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(onCompactionStarted).toHaveBeenCalledOnce();
		expect(onCompactionFinished).toHaveBeenCalledWith({
			summary: 'Conversation summary',
			summaryType: 'full',
		});
		expect(result).toEqual({
			summary: 'Conversation summary',
			summaryType: 'full',
		});

		expect(mocks.compactMock).toHaveBeenCalledWith([
			{ role: 'assistant', content: 'Tool call 1 result' },
			{ role: 'assistant', content: 'Tool call 2 result' },
			{ role: 'assistant', content: 'Tool call 3 result' },
		]);

		expect(messages).toEqual([
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'Current turn question' },
			{ role: 'assistant', content: 'Conversation summary' },
		]);
	});

	it('case 2: turn compaction includes history messages in summary when present', async () => {
		const messages: ModelMessage[] = [
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'Old question' },
			{ role: 'assistant', content: 'Old answer' },
			{ role: 'user', content: 'Current turn question' },
			{ role: 'assistant', content: 'Tool call 1 result' },
			{ role: 'assistant', content: 'Tool call 2 result' },
		];
		const onCompactionStarted = vi.fn();
		const onCompactionFinished = vi.fn();

		const result = await compactionService.compactConversationIfNeeded({
			chatId: 'chat-4',
			projectId: 'project-4',
			userId: 'user-4',
			provider: 'openai',
			messages,
			tools: {} as AgentTools,
			maxOutputTokens: 50,
			contextWindow: 30_000,
			onCompactionStarted,
			onCompactionFinished,
		});

		expect(result).toEqual({
			summary: 'Conversation summary',
			summaryType: 'full',
		});

		expect(mocks.compactMock).toHaveBeenCalledWith([
			{ role: 'user', content: 'Old question' },
			{ role: 'assistant', content: 'Old answer' },
			{ role: 'assistant', content: 'Tool call 1 result' },
			{ role: 'assistant', content: 'Tool call 2 result' },
		]);

		expect(messages).toEqual([
			{ role: 'system', content: 'System prompt' },
			{ role: 'user', content: 'Current turn question' },
			{ role: 'assistant', content: 'Conversation summary' },
		]);
	});
});

describe('compactionService.useLastCompaction', () => {
	const compactionService = new CompactionService({
		createCompactionLlm: () => ({ compact: mocks.compactMock }),
	});

	it('returns messages unchanged when no compaction exists', () => {
		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
			{ id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] },
		];

		const result = compactionService.useLastCompaction(messages);
		expect(result).toBe(messages);
	});

	it('case 1: history compaction reconstructs [SUMMARY, REST]', () => {
		mocks.findLastUserMessageMock.mockImplementation((msgs: UIMessage[], beforeIdx: number) => {
			for (let i = Math.min(msgs.length - 1, beforeIdx); i >= 0; i--) {
				if (msgs[i].role === 'user') {
					return [msgs[i], i];
				}
			}
			return [undefined, undefined];
		});

		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Old question' }] },
			{ id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Old answer' }] },
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Current question' }] },
			{
				id: '4',
				role: 'assistant',
				parts: [
					{ type: 'data-compaction', data: { summary: 'History summary', summaryType: 'partial' } },
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
		expect(result).toHaveLength(4);
	});

	it('case 2: turn compaction reconstructs [USER, SUMMARY, remaining_parts, REST]', () => {
		mocks.findLastUserMessageMock.mockImplementation((msgs: UIMessage[], beforeIdx: number) => {
			for (let i = Math.min(msgs.length - 1, beforeIdx); i >= 0; i--) {
				if (msgs[i].role === 'user') {
					return [msgs[i], i];
				}
			}
			return [undefined, undefined];
		});

		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Old question' }] },
			{ id: '2', role: 'assistant', parts: [{ type: 'text', text: 'Old answer' }] },
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Current question' }] },
			{
				id: '4',
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'Pre-compaction text' },
					{
						type: 'data-compaction',
						data: { summary: 'Turn summary', summaryType: 'full' },
					},
					{ type: 'text', text: 'Post-compaction text' },
				],
			},
			{ id: '5', role: 'user', parts: [{ type: 'text', text: 'New question' }] },
		];

		const result = compactionService.useLastCompaction(messages);

		expect(result[0]).toEqual(messages[2]);
		expect(result[1]).toEqual({
			role: 'assistant',
			parts: [{ type: 'text', text: 'Turn summary' }],
		});
		expect(result[2].parts).toEqual([{ type: 'text', text: 'Post-compaction text' }]);
		expect(result[3]).toEqual(messages[4]);
		expect(result).toHaveLength(4);
	});

	it('case 2: skips trimmed assistant message when no remaining parts exist', () => {
		mocks.findLastUserMessageMock.mockImplementation((msgs: UIMessage[], beforeIdx: number) => {
			for (let i = Math.min(msgs.length - 1, beforeIdx); i >= 0; i--) {
				if (msgs[i].role === 'user') {
					return [msgs[i], i];
				}
			}
			return [undefined, undefined];
		});

		const messages: UIMessage[] = [
			{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Question' }] },
			{
				id: '2',
				role: 'assistant',
				parts: [
					{ type: 'text', text: 'Some tool output' },
					{
						type: 'data-compaction',
						data: { summary: 'Full turn summary', summaryType: 'full' },
					},
				],
			},
			{ id: '3', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
		];

		const result = compactionService.useLastCompaction(messages);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual(messages[0]);
		expect(result[1]).toEqual({
			role: 'assistant',
			parts: [{ type: 'text', text: 'Full turn summary' }],
		});
		expect(result[2]).toEqual(messages[2]);
	});
});
