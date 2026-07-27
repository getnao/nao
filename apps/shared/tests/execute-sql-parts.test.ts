import { describe, expect, it } from 'vitest';

import { filterSupersededExecuteSqlParts, markSupersededExecuteSqlParts } from '../src/execute-sql-parts';

type TestPart = {
	type: string;
	toolCallId?: string;
	output?: { id?: string; superseded?: boolean };
};
type TestMessage = { id: string; parts: TestPart[] };

function executeSqlPart(queryId: string, rowCount: number): TestPart {
	return {
		type: 'tool-execute_sql',
		toolCallId: `call_${queryId}_${rowCount}`,
		output: { id: queryId },
	};
}

function message(id: string, parts: TestPart[]): TestMessage {
	return { id, parts };
}

describe('markSupersededExecuteSqlParts', () => {
	it('flags all but the last occurrence of a duplicated query id', () => {
		const messages = [
			message('m1', [executeSqlPart('query_abc', 1)]),
			message('m2', [executeSqlPart('query_other', 5)]),
			message('m3', [executeSqlPart('query_abc', 2)]),
		];

		const result = markSupersededExecuteSqlParts(messages);

		expect(result[0].parts[0].output?.superseded).toBe(true);
		expect(result[1].parts[0].output?.superseded).toBeUndefined();
		expect(result[2].parts[0].output?.superseded).toBeUndefined();
	});

	it('returns the same message objects when there are no duplicates', () => {
		const messages = [message('m1', [executeSqlPart('query_a', 1)]), message('m2', [executeSqlPart('query_b', 1)])];

		const result = markSupersededExecuteSqlParts(messages);

		expect(result[0]).toBe(messages[0]);
		expect(result[1]).toBe(messages[1]);
	});

	it('handles duplicates within the same message', () => {
		const messages = [message('m1', [executeSqlPart('query_a', 1), executeSqlPart('query_a', 2)])];

		const result = markSupersededExecuteSqlParts(messages);

		expect(result[0].parts[0].output?.superseded).toBe(true);
		expect(result[0].parts[1].output?.superseded).toBeUndefined();
	});

	it('ignores execute_sql parts without output', () => {
		const pending: TestPart = { type: 'tool-execute_sql', toolCallId: 'call_pending' };
		const messages = [message('m1', [pending, executeSqlPart('query_a', 1)])];

		const result = markSupersededExecuteSqlParts(messages);

		expect(result[0]).toBe(messages[0]);
	});
});

describe('filterSupersededExecuteSqlParts', () => {
	it('removes all but the last occurrence of a duplicated query id', () => {
		const first = executeSqlPart('query_abc', 1);
		const other = executeSqlPart('query_other', 5);
		const last = executeSqlPart('query_abc', 2);
		const messages = [message('m1', [first]), message('m2', [other]), message('m3', [last])];

		const result = filterSupersededExecuteSqlParts(messages);

		expect(result[0].parts).toEqual([]);
		expect(result[1].parts).toEqual([other]);
		expect(result[2].parts).toEqual([last]);
	});

	it('returns the same message objects when there are no duplicates', () => {
		const messages = [message('m1', [executeSqlPart('query_a', 1)]), message('m2', [executeSqlPart('query_b', 1)])];

		const result = filterSupersededExecuteSqlParts(messages);

		expect(result[0]).toBe(messages[0]);
		expect(result[1]).toBe(messages[1]);
	});
});
