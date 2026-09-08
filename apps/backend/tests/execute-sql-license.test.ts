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
import { hasFeature, LICENSE_FEATURES } from '../src/services/license.service';
import type { WarehouseTableAccess } from '../src/services/user-group-context-access.service';
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

	it.each([
		{
			name: 'unlicensed bypass',
			access: { enforced: false } as WarehouseTableAccess,
			expected: { enforced: false },
		},
		{
			name: 'licensed restricted empty',
			access: { enforced: true, tables: [] } as WarehouseTableAccess,
			expected: { enforced: true, tables: [] },
		},
		{
			name: 'licensed expanded schema or table grants',
			access: {
				enforced: true,
				tables: [
					{
						databaseType: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'orders',
					},
				],
			} as WarehouseTableAccess,
			expected: {
				enforced: true,
				tables: [
					{
						database_type: 'postgres',
						database: 'analytics',
						schema: 'public',
						table: 'orders',
					},
				],
			},
		},
	])('sends server-resolved table access for $name', async ({ access, expected }) => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = vi.fn(async () =>
			Response.json({
				data: [],
				row_count: 0,
				columns: [],
			}),
		);
		vi.stubGlobal('fetch', fetch);

		await executeQuery({ sql_query: 'SELECT 1' }, createContext(undefined, access));

		const [, init] = fetch.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(String(init.body)).table_access).toEqual(expected);
	});

	it('rejects an unsafe malformed access discriminant before sending', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const malformedAccess = { enforced: 0 } as unknown as WarehouseTableAccess;

		await expect(
			executeQuery({ sql_query: 'SELECT 1' }, createContext(undefined, malformedAccess)),
		).rejects.toThrow('invalid enforced discriminant');
		expect(fetch).not.toHaveBeenCalled();
	});
});

function createContext(
	storedSetting: boolean | undefined,
	warehouseTableAccess: WarehouseTableAccess = { enforced: false },
): ToolContext {
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
		warehouseTableAccess,
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}
