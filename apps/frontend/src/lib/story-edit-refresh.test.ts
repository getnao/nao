import { describe, expect, it } from 'vitest';
import { isOutdatedByEdit, readStoryEdit } from './story-edit-refresh';
import type { UIMessage } from '@nao/backend/chat';

describe('story edit refresh', () => {
	const cosmeticEdit = {
		changedQueryIds: new Set<string>(),
		editsFilters: false,
		referencedQueryIds: new Set<string>(),
	};

	it('reads the queries the agent ran, whether it edited filters, and the queries its story edit reads', () => {
		const messages = [
			assistantMessage('m1', [
				ranSql('q1', 'SELECT 1'),
				{ type: 'tool-execute_semantic_query', state: 'output-available', output: { id: 'q2' } },
				storyEdit('<filter id="region" dimension="customer__country" />\n<chart query_id="q9" />'),
			]),
		];

		expect(readStoryEdit(messages)).toEqual({
			changedQueryIds: new Set(['q1', 'q2']),
			editsFilters: true,
			referencedQueryIds: new Set(['q9']),
		});
	});

	it('marks the queries reading a changed query as changed too', () => {
		const messages = [
			assistantMessage('m1', [
				ranSql('query_dependent', 'SELECT * FROM query_upstream'),
				ranSql('query_unrelated', 'SELECT 2'),
				storyEdit('<chart query_id="query_dependent" />'),
			]),
			assistantMessage('m2', [
				ranSql('query_upstream', 'SELECT 3'),
				storyEdit('<chart query_id="query_upstream" />'),
			]),
		];

		expect(readStoryEdit(messages).changedQueryIds).toEqual(new Set(['query_upstream', 'query_dependent']));
	});

	it('reads the queries run since the previous story edit', () => {
		const messages = [
			assistantMessage('m1', [ranSql('q1', 'SELECT 1'), storyEdit('<chart query_id="q1" />')]),
			assistantMessage('m2', [ranSql('q2', 'SELECT 2')]),
			assistantMessage('m3', [storyEdit('<chart query_id="q2" />')]),
		];

		expect(readStoryEdit(messages).changedQueryIds).toEqual(new Set(['q2']));
	});

	it('refetches only the story itself after a cosmetic edit', () => {
		expect(isOutdatedByEdit(cached(['story', 'getLatest'], { chatId: 'c1' }), cosmeticEdit)).toBe(true);
		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q1' }), cosmeticEdit)).toBe(false);
		expect(isOutdatedByEdit(cached(['chat', 'get'], { chatId: 'c1' }), cosmeticEdit)).toBe(false);
	});

	it('refetches only the changed query results when the agent ran a query', () => {
		const edit = { ...cosmeticEdit, changedQueryIds: new Set(['q1']) };

		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q1' }), edit)).toBe(true);
		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q2' }), edit)).toBe(false);
		expect(isOutdatedByEdit(filtered({ q1: {} }), edit)).toBe(true);
		expect(isOutdatedByEdit(filtered({ q2: {} }), edit)).toBe(false);
	});

	it('refetches every query result when the agent edited filters', () => {
		const edit = { ...cosmeticEdit, editsFilters: true };

		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q2' }), edit)).toBe(true);
		expect(isOutdatedByEdit(filtered({ q1: {} }), edit)).toBe(true);
	});

	it('refetches filtered results when the edit reads a query they lack', () => {
		expect(isOutdatedByEdit(filtered({ q1: {} }), { ...cosmeticEdit, referencedQueryIds: new Set(['q1']) })).toBe(
			false,
		);
		expect(isOutdatedByEdit(filtered({ q1: {} }), { ...cosmeticEdit, referencedQueryIds: new Set(['q9']) })).toBe(
			true,
		);
	});
});

function assistantMessage(id: string, parts: object[]): UIMessage {
	return { id, role: 'assistant', parts } as never as UIMessage;
}

function ranSql(id: string, sqlQuery: string) {
	return { type: 'tool-execute_sql', state: 'output-available', input: { sql_query: sqlQuery }, output: { id } };
}

function storyEdit(replace: string) {
	return { type: 'tool-story', state: 'output-available', input: { replace } };
}

function filtered(data: object) {
	return cached(['story', 'getFilteredQueryData'], { selections: { region: 'EU' } }, data);
}

function cached(path: string[], input: object, data: unknown = undefined) {
	return { queryKey: [path, { input, type: 'query' }], state: { data } };
}
