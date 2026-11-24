import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamState } from '../../src/types/messaging-provider';

const mocks = vi.hoisted(() => ({ getExecuteSqlPartByQueryIdInChat: vi.fn() }));

vi.mock('../../src/queries/execute-sql.queries', () => ({
	getExecuteSqlPartByQueryIdInChat: mocks.getExecuteSqlPartByQueryIdInChat,
}));

const { resolveChatSqlOutput } = await import('../../src/utils/messaging-provider');

function streamState(): StreamState {
	return {
		renderedToolCallIds: new Set(),
		sqlOutputs: new Map(),
		lastUpdateAt: 0,
		toolGroup: new Map(),
		toolGroupBlockIndex: -1,
	};
}

describe('resolveChatSqlOutput', () => {
	beforeEach(() => {
		mocks.getExecuteSqlPartByQueryIdInChat.mockReset();
	});

	it('uses rows from a query run in the current answer', async () => {
		const state = streamState();
		state.sqlOutputs.set('query_now', { name: 'Now', rows: [{ orders: 1 }] });

		await expect(resolveChatSqlOutput(state, 'chat-1', 'query_now')).resolves.toEqual({
			name: 'Now',
			rows: [{ orders: 1 }],
		});
		expect(mocks.getExecuteSqlPartByQueryIdInChat).not.toHaveBeenCalled();
	});

	it('loads rows from an earlier answer in the same chat and caches them', async () => {
		const state = streamState();
		mocks.getExecuteSqlPartByQueryIdInChat.mockResolvedValue({
			toolInput: { name: 'Orders by month' },
			toolOutput: { data: [{ month: 'jan', orders: 3 }] },
		});

		const output = await resolveChatSqlOutput(state, 'chat-1', 'query_before');

		expect(mocks.getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('chat-1', 'query_before');
		expect(output).toEqual({ name: 'Orders by month', rows: [{ month: 'jan', orders: 3 }] });
		expect(state.sqlOutputs.get('query_before')).toEqual(output);
	});

	it('returns undefined when the query is not in the chat', async () => {
		mocks.getExecuteSqlPartByQueryIdInChat.mockResolvedValue(null);

		await expect(resolveChatSqlOutput(streamState(), 'chat-1', 'query_missing')).resolves.toBeUndefined();
	});
});
