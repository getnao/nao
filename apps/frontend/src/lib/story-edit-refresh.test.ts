import { describe, expect, it } from 'vitest';
import { isOutdatedByEdit, readStoryEdit } from './story-edit-refresh';
import type { UIMessage } from '@nao/backend/chat';

describe('story edit refresh', () => {
	const noQueries = { ranQueryIds: new Set<string>(), referencedQueryIds: new Set<string>() };

	it('lists the queries the agent ran and the ones its story edit reads', () => {
		const message = {
			id: 'm1',
			role: 'assistant',
			parts: [
				{ type: 'tool-execute_sql', state: 'output-available', output: { id: 'q1' } },
				{ type: 'tool-execute_semantic_query', state: 'output-available', output: { id: 'q2' } },
				{ type: 'tool-story', state: 'output-available', input: { replace: '<chart query_id="q9" />' } },
			],
		};

		expect(readStoryEdit(message as never as UIMessage)).toEqual({
			ranQueryIds: new Set(['q1', 'q2']),
			referencedQueryIds: new Set(['q9']),
		});
	});

	it('refetches the story and the query results the agent ran, nothing else', () => {
		const edit = { ...noQueries, ranQueryIds: new Set(['q1']) };

		expect(isOutdatedByEdit(cached(['story', 'getLatest'], { chatId: 'c1' }), edit)).toBe(true);
		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q1' }), edit)).toBe(true);
		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q2' }), edit)).toBe(false);
		expect(isOutdatedByEdit(cached(['chat', 'get'], { chatId: 'c1' }), edit)).toBe(false);
	});

	it('refetches filtered results only when the edit ran a query or reads one they lack', () => {
		const filtered = cached(['story', 'getFilteredQueryData'], { selections: { region: 'EU' } }, { q1: {} });

		expect(isOutdatedByEdit(filtered, { ...noQueries, referencedQueryIds: new Set(['q1']) })).toBe(false);
		expect(isOutdatedByEdit(filtered, { ...noQueries, referencedQueryIds: new Set(['q9']) })).toBe(true);
		expect(isOutdatedByEdit(filtered, { ...noQueries, ranQueryIds: new Set(['q5']) })).toBe(true);
	});
});

function cached(path: string[], input: object, data: unknown = undefined) {
	return { queryKey: [path, { input, type: 'query' }], state: { data } };
}
