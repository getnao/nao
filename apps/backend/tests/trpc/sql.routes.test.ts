import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	buildToolContext: vi.fn(),
	executeQuery: vi.fn(),
	getLatestExecuteSqlByQueryId: vi.fn(),
	updateExecuteSqlPart: vi.fn(),
}));

vi.mock('../../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../../src/agents/tools/execute-sql', () => ({ executeQuery: mocks.executeQuery }));
vi.mock('../../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getLatestExecuteSqlByQueryId: mocks.getLatestExecuteSqlByQueryId,
	updateExecuteSqlPart: mocks.updateExecuteSqlPart,
}));
vi.mock('../../src/queries/organization.queries', () => ({}));
vi.mock('../../src/queries/project.queries', () => ({}));
vi.mock('../../src/services/agent', () => ({ buildToolContext: mocks.buildToolContext }));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => false),
}));

import { sqlRoutes } from '../../src/trpc/sql.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router({ sql: sqlRoutes });
const caller = createTestCaller(testRouter, { selectedProjectId: null });
const existingSqlQuery = {
	projectId: 'project-id',
	userId: 'user-id',
	chatId: 'chat-id',
	toolCallId: 'tool-call-id',
	toolName: 'execute_sql' as const,
	toolInput: { sql_query: 'select 1' },
	toolOutput: { id: 'query-1', columns: [], data: [] },
	adminMode: false,
};

describe('SQL edit routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestExecuteSqlByQueryId.mockResolvedValue(existingSqlQuery);
		mocks.buildToolContext.mockResolvedValue({});
		mocks.executeQuery.mockResolvedValue(existingSqlQuery.toolOutput);
	});

	it.each(['previewQuery', 'updateQuery'] as const)('resolves the stored query once for %s', async (route) => {
		await caller.sql[route]({ queryId: 'query_1', sql_query: 'select 2' });

		expect(mocks.getLatestExecuteSqlByQueryId).toHaveBeenCalledTimes(1);
		expect(mocks.getLatestExecuteSqlByQueryId).toHaveBeenCalledWith('query_1');
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-id');
	});
});
