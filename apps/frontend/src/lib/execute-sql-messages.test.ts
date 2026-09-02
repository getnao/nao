import { describe, expect, it } from 'vitest';

import {
	applyExecuteSqlResultToMessages,
	areSourceQueriesEqual,
	findLatestExecuteSqlInMessages,
} from './execute-sql-messages';
import type { executeSql } from '@nao/shared/tools';
import type { UIMessage } from '@nao/backend/chat';
import type { SourceQuery } from './execute-sql-messages';

const createSourceQuery = (
	input: executeSql.Input,
	id: executeSql.Output['id'] = 'query_123',
	data: Record<string, unknown>[] = [{ revenue: 100 }],
	revision?: number,
): SourceQuery => ({
	input,
	output: {
		id,
		data,
		row_count: data.length,
		columns: ['revenue'],
		revision,
	},
});

describe('areSourceQueriesEqual', () => {
	it('treats null snapshots correctly', () => {
		expect(areSourceQueriesEqual(null, null)).toBe(true);
		expect(areSourceQueriesEqual(createSourceQuery({ sql_query: 'select 1' }), null)).toBe(false);
	});

	it('treats reallocated inputs with the same value and output id as equal', () => {
		const left = createSourceQuery({ sql_query: 'select revenue', database_id: 'warehouse' });
		const right = createSourceQuery({ sql_query: 'select revenue', database_id: 'warehouse' }, 'query_123', [
			{ revenue: 200 },
		]);

		expect(areSourceQueriesEqual(left, right)).toBe(true);
	});

	it('detects input value changes', () => {
		const left = createSourceQuery({ sql_query: 'select revenue' });
		const right = createSourceQuery({ sql_query: 'select profit' });

		expect(areSourceQueriesEqual(left, right)).toBe(false);
	});

	it('detects output id changes', () => {
		const input = { sql_query: 'select revenue' };
		const left = createSourceQuery(input, 'query_123');
		const right = createSourceQuery(input, 'query_456');

		expect(areSourceQueriesEqual(left, right)).toBe(false);
	});

	it('detects output revision changes', () => {
		const input = { sql_query: 'select revenue' };
		const left = createSourceQuery(input, 'query_123', [{ revenue: 100 }], 1);
		const right = createSourceQuery(input, 'query_123', [{ revenue: 100 }], 2);

		expect(areSourceQueriesEqual(left, right)).toBe(false);
	});

	it('treats identical output revisions as equal', () => {
		const input = { sql_query: 'select revenue' };
		const left = createSourceQuery(input, 'query_123', [{ revenue: 100 }], 1);
		const right = createSourceQuery(input, 'query_123', [{ revenue: 200 }], 1);

		expect(areSourceQueriesEqual(left, right)).toBe(true);
	});
});

describe('applyExecuteSqlResultToMessages', () => {
	it('bumps the output revision on each replacement', () => {
		const input: executeSql.Input = { sql_query: 'select revenue' };
		const output: executeSql.Output = {
			id: 'query_123',
			data: [{ revenue: 100 }],
			row_count: 1,
			columns: ['revenue'],
		};
		const messages = [
			{
				id: 'assistant-1',
				role: 'assistant',
				parts: [
					{
						type: 'tool-execute_sql',
						toolCallId: 'call-1',
						state: 'output-available',
						input,
						output,
					},
				],
			},
		] as unknown as UIMessage[];

		const firstReplacement = applyExecuteSqlResultToMessages(messages, output.id, input, output);
		const secondReplacement = applyExecuteSqlResultToMessages(firstReplacement, output.id, input, output);

		expect(findLatestExecuteSqlInMessages(firstReplacement, output.id)?.output.revision).toBe(1);
		expect(findLatestExecuteSqlInMessages(secondReplacement, output.id)?.output.revision).toBe(2);
	});
});
