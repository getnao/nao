import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/queries/chat.queries', () => ({ upsertMessage: vi.fn() }));

import { buildQueryDataParts } from '../src/utils/chat-message-story';

describe('buildQueryDataParts', () => {
	it('pins MCP query definitions with their cached results', () => {
		const [part] = buildQueryDataParts(
			{
				query_cost: { columns: ['total'], data: [{ total: 42 }] },
			},
			{
				query_cost: {
					sqlQuery:
						'SELECT 42 AS total {% filter period %} WHERE day IN ({{ filters.period.sql }}) {% endfilter %}',
					databaseId: 'warehouse',
				},
			},
		);

		expect(part).toMatchObject({
			type: 'tool-execute_sql',
			input: {
				sql_query:
					'SELECT 42 AS total {% filter period %} WHERE day IN ({{ filters.period.sql }}) {% endfilter %}',
				database_id: 'warehouse',
			},
			output: {
				id: 'query_cost',
				columns: ['total'],
				data: [{ total: 42 }],
			},
		});
	});

	it('keeps query-data-only pins compatible with chat-created queries', () => {
		const [part] = buildQueryDataParts({
			query_chat: { columns: ['value'], data: [{ value: 1 }] },
		});

		expect(part).toMatchObject({ input: { sql_query: '' } });
	});
});
