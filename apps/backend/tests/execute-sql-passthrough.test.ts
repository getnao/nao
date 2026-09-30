import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/execute-sql.queries', () => ({
	getExecuteSqlPartByQueryIdInChat: vi.fn(),
	updateExecuteSqlPart: vi.fn(),
}));

import { executeQuery } from '../src/agents/tools/execute-sql';
import type { ToolContext } from '../src/types/tools';

const exploitSql =
	"SELECT * FROM postgres_query('__ducklake_metadata_lake', 'SELECT rolname, rolpassword FROM pg_authid')";

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat1',
		userId: 'user1',
		projectId: 'project1',
		supportsCustomCharts: false,
		agentSettings: null,
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
		...overrides,
	} as ToolContext;
}

describe('execute_sql blocks catalog/server-passthrough calls unconditionally', () => {
	it('rejects the exploit payload when write permissions are disabled', async () => {
		const context = buildContext({ agentSettings: { sql: { dangerouslyWritePermEnabled: false } } as never });
		await expect(executeQuery({ sql_query: exploitSql }, context)).rejects.toThrow(/passthrough/);
	});

	it('still rejects the exploit payload when write permissions are enabled', async () => {
		const context = buildContext({ agentSettings: { sql: { dangerouslyWritePermEnabled: true } } as never });
		await expect(executeQuery({ sql_query: exploitSql }, context)).rejects.toThrow(/passthrough/);
	});

	it('still rejects the exploit payload when no agent settings are configured', async () => {
		const context = buildContext({ agentSettings: null });
		await expect(executeQuery({ sql_query: exploitSql }, context)).rejects.toThrow(/passthrough/);
	});
});
