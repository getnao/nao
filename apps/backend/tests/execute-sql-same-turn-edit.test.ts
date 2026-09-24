import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => false),
	LICENSE_FEATURES: { excludeColumns: 'exclude-columns' },
}));
vi.mock('../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getExecuteSqlPartByQueryIdInChat: vi.fn(async () => null),
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

import type { ToolCallOptions } from 'ai';

import executeSqlTool, { executeQuery } from '../src/agents/tools/execute-sql';
import { getExecuteSqlPartByQueryIdInChat, updateExecuteSqlPart } from '../src/queries/execute-sql.queries';
import type { ToolContext } from '../src/types/tools';

describe('execute_sql in-place edit of a query created in the current turn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ data: [{ n: 1 }], row_count: 1, columns: ['n'] })),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('re-runs a same-turn SQL query under its id when it is not persisted yet', async () => {
		const context = createContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context);

		const edited = await runTool({ sql_query: 'SELECT 2 AS n', query_id: created.id }, context);

		expect(getExecuteSqlPartByQueryIdInChat).toHaveBeenCalledWith('chat-1', created.id);
		expect(edited.id).toBe(created.id);
		expect(context.queryResults.get(created.id)).toEqual({ columns: ['n'], data: [{ n: 1 }] });
		expect(updateExecuteSqlPart).not.toHaveBeenCalled();
	});

	it('refuses to edit a same-turn semantic query as SQL', async () => {
		const context = createContext();
		const created = await executeQuery({ sql_query: 'SELECT 1 AS n' }, context, {
			compiledBySemanticLayer: true,
		});

		await expect(runTool({ sql_query: 'SELECT 2 AS n', query_id: created.id }, context)).rejects.toThrow(
			`Query ${created.id} is a semantic query and cannot be edited as SQL`,
		);
	});

	it('still reports unknown query ids', async () => {
		await expect(
			runTool({ sql_query: 'SELECT 2 AS n', query_id: 'query_missing0' }, createContext()),
		).rejects.toThrow('Query query_missing0 not found in this chat');
	});
});

async function runTool(input: Parameters<typeof executeQuery>[0], context: ToolContext) {
	const options = { toolCallId: 'call-1', messages: [], experimental_context: context } as ToolCallOptions;
	const output = await executeSqlTool.execute!(input, options);
	return output as Awaited<ReturnType<typeof executeQuery>>;
}

function createContext(): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: {},
		envVars: {},
		warehouseTableAccess: { enforced: false },
		warehouseRowSecurity: { enforced: false },
		docsContextAccess: { enforced: false } as ToolContext['docsContextAccess'],
		userGroupFeatures: [],
		userRulesGroupAccess: { enforced: false } as ToolContext['userRulesGroupAccess'],
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}
