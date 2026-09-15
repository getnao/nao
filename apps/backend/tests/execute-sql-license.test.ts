import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getExecuteSqlPartByQueryIdInChat: vi.fn(),
	updateExecuteSqlPart: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));
vi.mock('../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));
vi.mock('../src/services/local-query.service', () => ({
	runQueryOnLocalFiles: vi.fn(),
}));

import { executeQuery } from '../src/agents/tools/execute-sql';
import { queryAppDb } from '../src/agents/tools/query-app-db';
import { hasFeature, LICENSE_FEATURES } from '../src/services/license.service';
import { runQueryOnLocalFiles } from '../src/services/local-query.service';
import type { ToolContext } from '../src/types/tools';

const cases = [
	{ licensed: false, storedSetting: true, expected: false },
	{ licensed: true, storedSetting: undefined, expected: true },
	{ licensed: true, storedSetting: false, expected: false },
	{ licensed: true, storedSetting: true, expected: true },
] as const;

describe('execute_sql excluded-column enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(cases)(
		'sends $expected when licensed=$licensed and stored setting=$storedSetting',
		async ({ licensed, storedSetting, expected }) => {
			vi.mocked(hasFeature).mockResolvedValue(licensed);
			const fetch = vi.fn(async () =>
				Response.json({
					data: [],
					row_count: 0,
					columns: [],
				}),
			);
			vi.stubGlobal('fetch', fetch);

			await executeQuery({ sql_query: 'SELECT 1' }, createContext(storedSetting));

			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns);
			const [, init] = fetch.mock.calls[0] as [string, RequestInit];
			expect(JSON.parse(String(init.body))).toMatchObject({
				enforce_excluded_columns: expected,
			});
		},
	);
});

describe('execute_sql query definitions', () => {
	const sqlQuery =
		'SELECT 1 WHERE 1 = 1 {% filter category %} AND category = {{ filters.category.sql }} {% endfilter %}';

	beforeEach(() => {
		vi.mocked(queryAppDb).mockResolvedValue({ columns: ['value'], rows: [{ value: 1 }] });
		vi.mocked(runQueryOnLocalFiles).mockResolvedValue({
			result: { columns: ['value'], data: [{ value: 1 }] },
			savedFile: undefined,
		});
	});

	it.each([
		{ name: 'local', adminMode: false, databaseId: LOCAL_DATABASE_ID },
		{ name: 'admin', adminMode: true, databaseId: undefined },
	])('remembers the original filter template for $name queries', async ({ adminMode, databaseId }) => {
		const context = createContext(undefined);
		context.adminMode = adminMode;

		const output = await executeQuery({ sql_query: sqlQuery, database_id: databaseId }, context);

		expect(context.queryDefinitions?.get(output.id)).toEqual({
			sqlQuery,
			...(databaseId && { databaseId }),
		});
	});
});

function createContext(storedSetting: boolean | undefined): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings:
			storedSetting === undefined
				? {}
				: {
						sql: {
							enforceExcludedColumns: storedSetting,
						},
					},
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}
