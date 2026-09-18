import { describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
	getChatQueries: vi.fn(async () => ({})),
	getMcpQueries: vi.fn(async () => ({
		query_mcp: {
			sqlQuery:
				'SELECT * FROM payments WHERE 1=1 {% filter payment_method %} AND payment_method IN ({{ filters.payment_method.sql }}) {% endfilter %}',
			databaseId: 'warehouse',
		},
	})),
	loadChat: vi.fn(async () => [{ projectId: 'project-1', userId: 'user-1' }]),
}));

vi.mock('../src/db/db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(() => ({
						execute: queryMocks.loadChat,
					})),
				})),
			})),
		})),
	},
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getLatestSqlQueriesByIds: queryMocks.getChatQueries,
}));
vi.mock('../src/queries/mcp-query-data.queries', () => ({
	getMcpQueryDefinitions: queryMocks.getMcpQueries,
}));

import { getSqlQueriesFromCode } from '../src/queries/story.queries';

describe('getSqlQueriesFromCode', () => {
	it('falls back to the scoped MCP query definition', async () => {
		const result = await getSqlQueriesFromCode(
			'chat-1',
			'<chart query_id="query_mcp" chart_type="table" series=\'[{"data_key":"total"}]\' />',
		);

		expect(queryMocks.getMcpQueries).toHaveBeenCalledWith(new Set(['query_mcp']), 'project-1', 'user-1');
		expect(result.query_mcp).toMatchObject({
			databaseId: 'warehouse',
			adminMode: false,
		});
	});
});
