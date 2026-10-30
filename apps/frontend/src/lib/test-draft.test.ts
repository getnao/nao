import { describe, expect, it } from 'vitest';

import { getTestDraft } from './test-draft';
import type { UIMessage } from '@nao/backend/chat';

describe('getTestDraft', () => {
	it('uses the previous question and the last successful SQL of the answer', () => {
		const messages = [
			userMessage('u1', 'How many orders?'),
			assistantMessage('a1', [sqlPart('select 1', 'output-available')]),
			userMessage('u2', 'And the revenue per month?'),
			assistantMessage('a2', [
				sqlPart('select month, sum(amount) from orders group by 1', 'output-available', 'warehouse'),
				sqlPart('select broken', 'output-error'),
				{ type: 'text', text: 'Here is the revenue.' },
			]),
		];

		expect(getTestDraft(messages, messages[3])).toEqual({
			name: 'And the revenue per month?',
			prompt: 'And the revenue per month?',
			sql: 'select month, sum(amount) from orders group by 1',
			databaseId: 'warehouse',
		});
	});

	it('skips queries on the local database, which read results of this chat only', () => {
		const messages = [
			userMessage('u1', 'Revenue per month, as a share of the total?'),
			assistantMessage('a1', [
				sqlPart('select month, sum(amount) from orders group by 1', 'output-available', 'warehouse'),
				sqlPart(
					'select month, total / sum(total) over () from query_ab12cd34',
					'output-available',
					'duckdb_local',
				),
			]),
		];

		expect(getTestDraft(messages, messages[1])?.sql).toBe('select month, sum(amount) from orders group by 1');
	});

	it('returns nothing when the answer ran no SQL', () => {
		const messages = [userMessage('u1', 'Hello'), assistantMessage('a1', [{ type: 'text', text: 'Hi!' }])];

		expect(getTestDraft(messages, messages[1])).toBeNull();
	});

	it('truncates long questions in the default name', () => {
		const question = `Show me ${'the revenue '.repeat(10)}`;
		const messages = [
			userMessage('u1', question),
			assistantMessage('a1', [sqlPart('select 1', 'output-available')]),
		];

		const draft = getTestDraft(messages, messages[1]);

		expect(draft?.name).toHaveLength(80);
		expect(draft?.name.endsWith('…')).toBe(true);
		expect(draft?.prompt).toBe(question.trim());
	});
});

function userMessage(id: string, text: string): UIMessage {
	return { id, role: 'user', parts: [{ type: 'text', text }] } as UIMessage;
}

function assistantMessage(id: string, parts: unknown[]): UIMessage {
	return { id, role: 'assistant', parts } as UIMessage;
}

function sqlPart(sqlQuery: string, state: string, databaseId?: string) {
	return {
		type: 'tool-execute_sql',
		toolCallId: `call-${sqlQuery}`,
		state,
		input: { sql_query: sqlQuery, database_id: databaseId },
		output: state === 'output-available' ? { id: 'query', columns: [], data: [] } : undefined,
	};
}
