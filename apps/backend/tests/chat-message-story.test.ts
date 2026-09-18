import { describe, expect, it, vi } from 'vitest';

import { buildQueryDataParts } from '../src/utils/chat-message-story';

vi.mock('../src/queries/chat.queries', () => ({
	upsertMessage: vi.fn(),
}));

describe('buildQueryDataParts', () => {
	it('pins MCP query definitions with their cached rows', () => {
		const parts = buildQueryDataParts(
			{
				query_payments: {
					columns: ['total'],
					data: [{ total: 871 }],
				},
			},
			{
				query_payments: {
					sqlQuery:
						'SELECT SUM(amount) FROM payments WHERE 1=1 {% filter payment_method %} AND payment_method IN ({{ filters.payment_method.sql }}) {% endfilter %}',
					databaseId: 'warehouse',
				},
			},
		);

		expect(parts[0]).toMatchObject({
			input: {
				sql_query:
					'SELECT SUM(amount) FROM payments WHERE 1=1 {% filter payment_method %} AND payment_method IN ({{ filters.payment_method.sql }}) {% endfilter %}',
				database_id: 'warehouse',
			},
			output: {
				id: 'query_payments',
				columns: ['total'],
				data: [{ total: 871 }],
			},
		});
	});
});
