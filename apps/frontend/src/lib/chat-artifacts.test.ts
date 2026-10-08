import { describe, expect, it } from 'vitest';
import { areChatArtifactsEqual, collectChatArtifacts, countChatArtifacts } from './chat-artifacts';
import type { UIMessage, UIMessagePart } from '@nao/backend/chat';

function queryPart(id: string, name: string | undefined, columns: string[], rowCount: number): UIMessagePart {
	return {
		type: 'tool-execute_sql',
		toolCallId: `call_${id}_${rowCount}`,
		state: 'output-available',
		input: { sql_query: 'SELECT 1', name },
		output: { _version: '1', id, columns, row_count: rowCount, data: [] },
	} as unknown as UIMessagePart;
}

function storyPart(id: string, title: string): UIMessagePart {
	return {
		type: 'tool-story',
		toolCallId: `call_story_${id}`,
		state: 'output-available',
		input: { action: 'create', id, title, code: '# story' },
		output: { _version: '1', success: true, id, version: 1, code: '# story', title },
	} as unknown as UIMessagePart;
}

function filePart(path: string, filename: string, mediaType = 'text/csv'): UIMessagePart {
	return { type: 'file', url: path, filename, mediaType } as UIMessagePart;
}

function message(id: string, role: 'user' | 'assistant', ...parts: UIMessagePart[]): UIMessage {
	return { id, role, parts };
}

describe('collectChatArtifacts', () => {
	it('gathers stories, user files and the latest run of every query', () => {
		const messages = [
			message(
				'u1',
				'user',
				{ type: 'text', text: 'Analyse this' },
				filePart('/home/uploads/sales.csv', 'sales.csv'),
			),
			message(
				'a1',
				'assistant',
				queryPart('query_a', 'Monthly revenue', ['month', 'revenue'], 12),
				queryPart('query_b', undefined, ['total'], 1),
				storyPart('revenue', 'Revenue'),
			),
			message('u2', 'user', filePart('/home/uploads/sales.csv', 'sales.csv')),
			message('a2', 'assistant', queryPart('query_a', 'Monthly revenue', ['month', 'revenue', 'orders'], 13)),
		];

		const artifacts = collectChatArtifacts(messages);

		expect(artifacts.stories).toEqual([{ id: 'revenue', title: 'Revenue' }]);
		expect(artifacts.files).toEqual([
			{ path: '/home/uploads/sales.csv', filename: 'sales.csv', mediaType: 'text/csv' },
		]);
		expect(artifacts.queries.map((query) => [query.id, query.rowCount, query.toolCallId])).toEqual([
			['query_a', 13, 'call_query_a_13'],
			['query_b', 1, 'call_query_b_1'],
		]);
		expect(collectChatArtifacts(messages)).toBe(artifacts);
	});

	it('ignores files the assistant produced and queries still running', () => {
		const pending = { ...queryPart('query_c', undefined, [], 0), state: 'input-available', output: undefined };
		const messages = [
			message('a1', 'assistant', filePart('/home/exports/out.csv', 'out.csv'), pending as UIMessagePart),
		];

		expect(collectChatArtifacts(messages)).toEqual({ stories: [], files: [], queries: [] });
	});

	it('counts queries only when asked to', () => {
		const artifacts = collectChatArtifacts([
			message('a1', 'assistant', queryPart('query_a', undefined, ['x'], 1), storyPart('s', 'S')),
		]);

		expect(countChatArtifacts(artifacts, true)).toBe(2);
		expect(countChatArtifacts(artifacts, false)).toBe(1);
	});

	it('compares artifacts by content', () => {
		const build = () => collectChatArtifacts([message('a1', 'assistant', queryPart('query_a', 'A', ['x'], 1))]);
		const changed = collectChatArtifacts([message('a1', 'assistant', queryPart('query_a', 'A', ['x'], 2))]);

		expect(areChatArtifactsEqual(build(), build())).toBe(true);
		expect(areChatArtifactsEqual(build(), changed)).toBe(false);
	});
});
