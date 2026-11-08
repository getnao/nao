import { describe, expect, it } from 'vitest';
import { isOutdatedByEdit, readStoryEdit } from './story-edit-refresh';
import type { UIMessage } from '@nao/backend/chat';

describe('story edit refresh', () => {
	const cosmeticEdit = { hasRanQuery: false, editsFilters: false, referencedQueryIds: new Set<string>() };

	it('reads whether the agent ran a query or edited filters, and the queries its story edit reads', () => {
		const message = {
			id: 'm1',
			role: 'assistant',
			parts: [
				{ type: 'tool-execute_sql', state: 'output-available', output: { id: 'q1' } },
				{ type: 'tool-execute_semantic_query', state: 'output-available', output: { id: 'q2' } },
				{
					type: 'tool-story',
					state: 'output-available',
					input: { replace: '<filter id="region" dimension="customer__country" />\n<chart query_id="q9" />' },
				},
			],
		};

		expect(readStoryEdit(message as never as UIMessage)).toEqual({
			hasRanQuery: true,
			editsFilters: true,
			referencedQueryIds: new Set(['q9']),
		});
	});

	it('refetches only the story itself after a cosmetic edit', () => {
		expect(isOutdatedByEdit(cached(['story', 'getLatest'], { chatId: 'c1' }), cosmeticEdit)).toBe(true);
		expect(isOutdatedByEdit(cached(['story', 'getLiveQueryData'], { queryId: 'q1' }), cosmeticEdit)).toBe(false);
		expect(isOutdatedByEdit(cached(['chat', 'get'], { chatId: 'c1' }), cosmeticEdit)).toBe(false);
	});

	it('refetches every query result when the agent ran a query or edited filters', () => {
		const liveQuery = cached(['story', 'getLiveQueryData'], { queryId: 'q2' });
		const filtered = cached(['story', 'getFilteredQueryData'], { selections: { region: 'EU' } }, { q1: {} });

		for (const edit of [
			{ ...cosmeticEdit, hasRanQuery: true },
			{ ...cosmeticEdit, editsFilters: true },
		]) {
			expect(isOutdatedByEdit(liveQuery, edit)).toBe(true);
			expect(isOutdatedByEdit(filtered, edit)).toBe(true);
		}
	});

	it('refetches filtered results when the edit reads a query they lack', () => {
		const filtered = cached(['story', 'getFilteredQueryData'], { selections: { region: 'EU' } }, { q1: {} });

		expect(isOutdatedByEdit(filtered, { ...cosmeticEdit, referencedQueryIds: new Set(['q1']) })).toBe(false);
		expect(isOutdatedByEdit(filtered, { ...cosmeticEdit, referencedQueryIds: new Set(['q9']) })).toBe(true);
	});
});

function cached(path: string[], input: object, data: unknown = undefined) {
	return { queryKey: [path, { input, type: 'query' }], state: { data } };
}
