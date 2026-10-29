import { describe, expect, it } from 'vitest';

import {
	applyExecuteSqlResultToMessages,
	applySemanticQueryResultToMessages,
	areSourceQueriesEqual,
	findLatestExecuteSqlInMessages,
	isSemanticSourceQuery,
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

describe('findLatestExecuteSqlInMessages', () => {
	it('reads a semantic query result as the SQL the layer compiled', () => {
		const sourceQuery = findLatestExecuteSqlInMessages(createSemanticQueryMessages(), 'query_sem1');

		expect(sourceQuery?.input).toEqual({
			sql_query: 'SELECT SUM(amount) AS revenue FROM orders',
			database_id: 'warehouse',
			name: 'Revenue by month',
		});
		expect(sourceQuery?.output.data).toEqual([{ revenue: 100 }]);
	});

	it('keeps the metric query a semantic result was compiled from', () => {
		const sourceQuery = findLatestExecuteSqlInMessages(createSemanticQueryMessages(), 'query_sem1');

		expect(sourceQuery?.semanticQuery).toEqual({ metrics: ['revenue'], group_by: ['metric_time__month'] });
		expect(sourceQuery && isSemanticSourceQuery(sourceQuery)).toBe(true);
	});

	it('does not read a plain SQL result as a semantic one', () => {
		expect(isSemanticSourceQuery(createSourceQuery({ sql_query: 'select revenue' }))).toBe(false);
	});
});

describe('applySemanticQueryResultToMessages', () => {
	it('replaces the semantic part with the edited metric query and its new result', () => {
		const messages = createSemanticQueryMessages();
		const input = { metrics: ['revenue'], group_by: ['metric_time__week'], name: 'Revenue by month' };
		const output = {
			id: 'query_sem1' as const,
			data: [{ revenue: 40 }, { revenue: 60 }],
			row_count: 2,
			columns: ['revenue'],
			compiled_sql: 'SELECT SUM(amount) AS revenue FROM orders GROUP BY week',
			database_id: 'warehouse',
		};

		const updated = applySemanticQueryResultToMessages(messages, 'query_sem1', input, output);
		const sourceQuery = findLatestExecuteSqlInMessages(updated, 'query_sem1');

		expect(sourceQuery?.semanticQuery).toEqual({ metrics: ['revenue'], group_by: ['metric_time__week'] });
		expect(sourceQuery?.input?.sql_query).toBe(output.compiled_sql);
		expect(sourceQuery?.output.data).toEqual(output.data);
		expect(sourceQuery?.output.revision).toBe(1);
	});

	it('leaves execute_sql parts with the same query id untouched', () => {
		const sqlOutput: executeSql.Output = { id: 'query_sem1', data: [], row_count: 0, columns: [] };
		const messages = [
			{
				id: 'assistant-1',
				role: 'assistant',
				parts: [
					{
						type: 'tool-execute_sql',
						toolCallId: 'call-1',
						state: 'output-available',
						input: {},
						output: sqlOutput,
					},
				],
			},
		] as unknown as UIMessage[];

		const updated = applySemanticQueryResultToMessages(
			messages,
			'query_sem1',
			{ metrics: ['revenue'] },
			{
				...sqlOutput,
				compiled_sql: 'SELECT 1',
				database_id: 'warehouse',
			},
		);

		expect(updated).toBe(messages);
	});
});

describe('areSourceQueriesEqual with semantic queries', () => {
	it('detects metric query changes behind the same compiled SQL', () => {
		const left = { ...createSourceQuery({ sql_query: 'select revenue' }), semanticQuery: { metrics: ['revenue'] } };
		const right = { ...left, semanticQuery: { metrics: ['revenue'], limit: 10 } };

		expect(areSourceQueriesEqual(left, right)).toBe(false);
	});
});

function createSemanticQueryMessages(): UIMessage[] {
	return [
		{
			id: 'assistant-1',
			role: 'assistant',
			parts: [
				{
					type: 'tool-execute_semantic_query',
					toolCallId: 'call-1',
					state: 'output-available',
					input: { metrics: ['revenue'], group_by: ['metric_time__month'], name: 'Revenue by month' },
					output: {
						id: 'query_sem1',
						data: [{ revenue: 100 }],
						row_count: 1,
						columns: ['revenue'],
						compiled_sql: 'SELECT SUM(amount) AS revenue FROM orders',
						database_id: 'warehouse',
					},
				},
			],
		},
	] as unknown as UIMessage[];
}
