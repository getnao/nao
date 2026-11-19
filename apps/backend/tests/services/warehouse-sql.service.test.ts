import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunSqlQueryTag } from '../../src/services/sql-query-tag.service';
import { executeWarehouseSql } from '../../src/services/warehouse-sql.service';

const QUERY_TAG: RunSqlQueryTag = {
	config: { template: 'nao {{ user_email }} {{ database_id }}', position: 'end' },
	variables: {
		user_id: 'user-1',
		user_email: 'ada@example.com',
		user_groups: '',
		project_id: 'project-1',
		chat_id: 'chat-1',
		source: 'web',
	},
	defaultDatabaseId: '',
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('executeWarehouseSql', () => {
	it.each([
		{
			name: 'sends the rendered tag of the run',
			queryTag: QUERY_TAG,
			expected: { comment: 'nao ada@example.com lake', position: 'end' },
		},
		{ name: 'sends no tag for a project that tags nothing', queryTag: null, expected: undefined },
	])('$name', async ({ queryTag, expected }) => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			Response.json({ data: [], row_count: 0, columns: [] }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await executeWarehouseSql('SELECT 1', {
			projectFolder: '/project',
			databaseId: 'lake',
			enforceExcludedColumns: false,
			tableAccess: { enforced: false },
			rowSecurity: { enforced: false },
			queryTag,
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
		expect(body.sql).toBe('SELECT 1');
		expect(body.query_tag).toEqual(expected);
	});
});
