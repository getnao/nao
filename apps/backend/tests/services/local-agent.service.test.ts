import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getChatOwnerId: vi.fn(),
	upsertMessage: vi.fn(),
	findLocalAgentSession: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	getChatOwnerId: mocks.getChatOwnerId,
	upsertMessage: mocks.upsertMessage,
}));
vi.mock('../../src/services/local-agent-session', () => ({
	findLocalAgentSession: mocks.findLocalAgentSession,
	openLocalAgentSession: vi.fn(),
}));

import { completeLocalAgentTurn } from '../../src/services/local-agent.service';
import type { LocalAgentTurnCompletion } from '../../src/types/local-agent';

const SERVER_OUTPUT = { id: 'query_1', columns: ['orders'], data: [{ orders: 42 }] };

function completion(parts: LocalAgentTurnCompletion['message']['parts']): LocalAgentTurnCompletion {
	return {
		chatId: 'chat-1',
		message: { id: 'message-1', role: 'assistant', parts },
		modelId: 'claude-sonnet-5-5',
		stopReason: 'stop',
	};
}

const reportedToolPart = {
	type: 'tool-execute_sql',
	toolCallId: 'toolu_1',
	state: 'output-available',
	input: { sql_query: 'select 1' },
	output: { id: 'query_1', columns: ['orders'], data: [{ orders: 1_000_000 }] },
};

describe('completeLocalAgentTurn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getChatOwnerId.mockResolvedValue('user-1');
		mocks.upsertMessage.mockResolvedValue({ messageId: 'message-1' });
		mocks.findLocalAgentSession.mockReturnValue({
			recordedToolCalls: new Map([
				['toolu_1', { toolName: 'execute_sql', input: { sql_query: 'select 1' }, output: SERVER_OUTPUT }],
			]),
		});
	});

	it('saves the answer with the tool results the server produced, outside any provider budget', async () => {
		await completeLocalAgentTurn('user-1', completion([{ type: 'text', text: '42 orders' }, reportedToolPart]));

		const saved = mocks.upsertMessage.mock.calls[0][0];
		expect(saved.parts).toEqual([
			{ type: 'text', text: '42 orders' },
			{ ...reportedToolPart, output: SERVER_OUTPUT },
		]);
		expect(saved).toMatchObject({ chatId: 'chat-1', llmModelId: 'claude-sonnet-5-5', stopReason: 'stop' });
		expect(saved.llmProvider).toBeUndefined();
		expect(saved.tokenUsage).toBeUndefined();
	});

	it("refuses to save into someone else's chat", async () => {
		mocks.getChatOwnerId.mockResolvedValue('user-2');

		await expect(completeLocalAgentTurn('user-1', completion([]))).rejects.toThrow('not authorized');
		expect(mocks.upsertMessage).not.toHaveBeenCalled();
	});
});
