import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => false),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getExecuteSqlPartByQueryIdInChat: vi.fn(async () => null),
	updateExecuteSqlPart: vi.fn(),
}));
vi.mock('../../src/queries/project.queries', () => ({
	getAgentSettings: vi.fn(),
}));
vi.mock('../../src/agents/tools/query-app-db', () => ({
	queryAppDb: vi.fn(),
}));
vi.mock('../../src/services/local-query.service', () => ({
	runQueryOnLocalFiles: vi.fn(),
}));

import executeSqlTool, { executeQuery } from '../../src/agents/tools/execute-sql';
import { getExecuteSqlPartByQueryIdInChat, updateExecuteSqlPart } from '../../src/queries/execute-sql.queries';
import { hasFeature, LICENSE_FEATURES } from '../../src/services/license.service';
import type { WarehouseTableAccess } from '../../src/services/user-group-context-access.service';
import type { ToolContext } from '../../src/types/tools';
import { createToolContext, executeTool } from '../helpers/tool-context';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('execute_sql excluded-column enforcement', () => {
	it.each([
		{ licensed: false, storedSetting: true, expected: false },
		{ licensed: true, storedSetting: undefined, expected: true },
		{ licensed: true, storedSetting: false, expected: false },
		{ licensed: true, storedSetting: true, expected: true },
	] as const)(
		'sends $expected when licensed=$licensed and stored setting=$storedSetting',
		async ({ licensed, storedSetting, expected }) => {
			vi.mocked(hasFeature).mockResolvedValue(licensed);
			const fetch = stubWarehouseFetch();

			await executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(storedSetting));

			expect(hasFeature).toHaveBeenCalledWith(LICENSE_FEATURES.excludeColumns);
			expect(sentBody(fetch)).toMatchObject({ enforce_excluded_columns: expected });
		},
	);

	it.each([
		{
			name: 'unlicensed bypass',
			access: { enforced: false } as WarehouseTableAccess,
			expected: { enforced: false },
		},
		{
			name: 'licensed strict restricted empty',
			access: { enforced: true, strict: true, tables: [] } as WarehouseTableAccess,
			expected: { enforced: true, tables: [] },
		},
		{
			name: 'licensed non-strict filtered access',
			access: {
				enforced: true,
				strict: false,
				tables: [{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			} as WarehouseTableAccess,
			expected: { enforced: false },
		},
		{
			name: 'licensed expanded schema or table grants',
			access: {
				enforced: true,
				strict: true,
				tables: [{ databaseType: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			} as WarehouseTableAccess,
			expected: {
				enforced: true,
				tables: [{ database_type: 'postgres', database: 'analytics', schema: 'public', table: 'orders' }],
			},
		},
	])('sends server-resolved table access for $name', async ({ access, expected }) => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = stubWarehouseFetch();

		await executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(undefined, access));

		expect(sentBody(fetch).table_access).toEqual(expected);
	});

	it('rejects an unsafe malformed access discriminant before sending', async () => {
		vi.mocked(hasFeature).mockResolvedValue(false);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const malformedAccess = { enforced: 0 } as unknown as WarehouseTableAccess;

		await expect(
			executeQuery({ sql_query: 'SELECT 1' }, createLicenseContext(undefined, malformedAccess)),
		).rejects.toThrow('invalid enforced discriminant');
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('execute_sql in-place edit of a query created in the current turn', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ data: [{ n: 1 }], row_count: 1, columns: ['n'] })),
		);
	});

	it('re-runs a same-turn SQL query under its id when it is not persisted yet', async () => {
		const context = createToolContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context);

		const edited = await executeTool(executeSqlTool, { sql_query: 'SELECT 2 AS n', query_id: created.id }, context);

		expect(getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('chat-1', created.id);
		expect(edited.id).toBe(created.id);
		expect(context.queryResults.get(created.id)).toEqual({ columns: ['n'], data: [{ n: 1 }] });
		expect(updateExecuteSqlPart).not.toHaveBeenCalled();
	});

	it('refuses to edit a same-turn semantic query as SQL', async () => {
		const context = createToolContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context, {
			compiledBySemanticLayer: true,
		});

		await expect(
			executeTool(executeSqlTool, { sql_query: 'SELECT 2 AS n', query_id: created.id }, context),
		).rejects.toThrow(`Query ${created.id} is a semantic query and cannot be edited as SQL`);
	});

	it('still reports unknown query ids', async () => {
		await expect(
			executeTool(
				executeSqlTool,
				{ sql_query: 'SELECT 2 AS n', query_id: 'query_missing0' },
				createToolContext(),
			),
		).rejects.toThrow('Query query_missing0 not found in this chat');
	});
});

describe('execute_sql blocks catalog/server-passthrough calls unconditionally', () => {
	const exploitSql =
		"SELECT * FROM postgres_query('__ducklake_metadata_lake', 'SELECT rolname, rolpassword FROM pg_authid')";

	it.each([
		[
			'rejects the exploit payload when write permissions are disabled',
			{ sql: { dangerouslyWritePermEnabled: false } },
		],
		[
			'still rejects the exploit payload when write permissions are enabled',
			{ sql: { dangerouslyWritePermEnabled: true } },
		],
		['still rejects the exploit payload when no agent settings are configured', null],
	])('%s', async (_name, agentSettings) => {
		await expect(
			executeQuery({ sql_query: exploitSql }, createToolContext({ agentSettings: agentSettings as never })),
		).rejects.toThrow(/passthrough/);
	});
});

function createLicenseContext(
	storedSetting: boolean | undefined,
	warehouseTableAccess: WarehouseTableAccess = { enforced: false },
): ToolContext {
	return createToolContext({
		agentSettings: storedSetting === undefined ? {} : { sql: { enforceExcludedColumns: storedSetting } },
		warehouseTableAccess,
	});
}

function stubWarehouseFetch() {
	const fetch = vi.fn(async () => Response.json({ data: [], row_count: 0, columns: [] }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

function sentBody(fetch: ReturnType<typeof stubWarehouseFetch>) {
	const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
	return JSON.parse(String(init.body));
}
