import type { readQueryResult } from '@nao/shared/tools';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getQueryResultByQueryId: vi.fn(async () => null),
}));

import readQueryResultTool from '../src/agents/tools/read-query-result';
import type { QueryResult, ToolContext } from '../src/types/tools';

const rows = Array.from({ length: 500 }, (_, index) => ({ id: index }));

async function execute(input: readQueryResult.Input): Promise<readQueryResult.Output> {
	const context = {
		queryResults: new Map<string, QueryResult>([['query_big', { columns: ['id'], data: rows }]]),
		chatId: 'chat1',
	} as unknown as ToolContext;
	return (await readQueryResultTool.execute!(input, {
		experimental_context: context,
	} as Parameters<NonNullable<typeof readQueryResultTool.execute>>[1])) as readQueryResult.Output;
}

describe('read_query_result execute', () => {
	it('returns 20 rows by default', async () => {
		const output = await execute({ query_id: 'query_big' });

		expect(output.data).toHaveLength(20);
		expect(output.limit).toBe(20);
	});

	it('caps the requested limit at 100 rows', async () => {
		const output = await execute({ query_id: 'query_big', offset: 10, limit: 10_000 });

		expect(output.data).toHaveLength(100);
		expect(output.data[0]).toEqual({ id: 10 });
		expect(output.limit).toBe(100);
		expect(output.row_count).toBe(500);
	});
});
