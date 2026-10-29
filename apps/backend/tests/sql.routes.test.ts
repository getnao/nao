import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	buildToolContext: vi.fn(),
	compileSemanticQuery: vi.fn(),
	executeQuery: vi.fn(),
	getLatestExecuteSqlByQueryId: vi.fn(),
	updateExecuteSqlPart: vi.fn(),
	updateSemanticQueryPart: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getSession: vi.fn() }));
vi.mock('../src/agents/tools/execute-sql', () => ({ executeQuery: mocks.executeQuery }));
vi.mock('../src/queries/execute-sql.queries', () => ({
	EXECUTE_SEMANTIC_QUERY_TOOL_NAME: 'execute_semantic_query',
	getLatestExecuteSqlByQueryId: mocks.getLatestExecuteSqlByQueryId,
	updateExecuteSqlPart: mocks.updateExecuteSqlPart,
	updateSemanticQueryPart: mocks.updateSemanticQueryPart,
}));
vi.mock('../src/queries/organization.queries', () => ({}));
vi.mock('../src/queries/project.queries', () => ({}));
vi.mock('../src/services/agent', () => ({ buildToolContext: mocks.buildToolContext }));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../src/services/semantic-layer.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/semantic-layer.service')>()),
	compileSemanticQuery: mocks.compileSemanticQuery,
}));
vi.mock('../src/services/sso-group-mapping.service', () => ({
	isOrganizationRoleMappingActive: vi.fn(async () => false),
}));

import { SemanticQueryCompileError } from '../src/services/semantic-layer.service';
import { sqlRoutes } from '../src/trpc/sql.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router({ sql: sqlRoutes });
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
const existingSemanticQuery = {
	...existingSqlQuery,
	toolName: 'execute_semantic_query' as const,
	toolInput: { sql_query: 'SELECT sum(amount) AS revenue FROM orders', database_id: 'warehouse', name: 'Revenue' },
	semanticQuery: { metrics: ['revenue'] },
};
const compiled = {
	sql: 'SELECT sum(amount - refunds) AS revenue FROM orders',
	database_id: 'warehouse',
	dialect: 'duckdb',
};

describe('SQL edit routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestExecuteSqlByQueryId.mockResolvedValue(existingSqlQuery);
		mocks.buildToolContext.mockResolvedValue({});
		mocks.executeQuery.mockResolvedValue(existingSqlQuery.toolOutput);
	});

	it.each(['previewQuery', 'updateQuery'] as const)('resolves the stored query once for %s', async (route) => {
		await createCaller().sql[route]({ queryId: 'query_1', sql_query: 'select 2' });

		expect(mocks.getLatestExecuteSqlByQueryId).toHaveBeenCalledTimes(1);
		expect(mocks.getLatestExecuteSqlByQueryId).toHaveBeenCalledWith('query_1');
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-id');
	});
});

describe('semantic query edit routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getLatestExecuteSqlByQueryId.mockResolvedValue(existingSemanticQuery);
		mocks.buildToolContext.mockResolvedValue({});
		mocks.compileSemanticQuery.mockResolvedValue(compiled);
		mocks.executeQuery.mockResolvedValue({ id: 'query_1', columns: ['revenue'], data: [{ revenue: 90 }] });
	});

	it('compiles the edited definition again, runs it under the same id and saves the semantic part', async () => {
		const query = { metrics: ['revenue'], group_by: ['metric_time__month'] };

		const result = await createCaller().sql.updateSemanticQuery({ queryId: 'query_1', query });

		expect(mocks.compileSemanticQuery).toHaveBeenCalledWith(query, {});
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			expect.objectContaining({ sql_query: compiled.sql, database_id: 'warehouse', query_id: 'query_1' }),
			{},
			{ semanticQuery: query },
		);
		expect(mocks.updateSemanticQueryPart).toHaveBeenCalledWith(
			'tool-call-id',
			{ ...query, name: 'Revenue' },
			expect.objectContaining({ id: 'query_1', compiled_sql: compiled.sql, database_id: 'warehouse' }),
		);
		expect(result.output.compiled_sql).toBe(compiled.sql);
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-id');
	});

	it('previews without saving', async () => {
		await createCaller().sql.previewSemanticQuery({ queryId: 'query_1', query: { metrics: ['revenue'] } });

		expect(mocks.executeQuery).toHaveBeenCalledOnce();
		expect(mocks.updateSemanticQueryPart).not.toHaveBeenCalled();
	});

	it('compiles without running the query on the warehouse', async () => {
		await expect(
			createCaller().sql.compileSemanticQuery({ queryId: 'query_1', query: { metrics: ['revenue'] } }),
		).resolves.toEqual(compiled);

		expect(mocks.executeQuery).not.toHaveBeenCalled();
		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('reports a definition the semantic layer rejects as a bad request', async () => {
		mocks.compileSemanticQuery.mockRejectedValue(new SemanticQueryCompileError('Unknown metric `revenu`'));

		await expect(
			createCaller().sql.compileSemanticQuery({ queryId: 'query_1', query: { metrics: ['revenu'] } }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Unknown metric `revenu`' });
	});

	it('refuses to edit a SQL query as a semantic one', async () => {
		mocks.getLatestExecuteSqlByQueryId.mockResolvedValue(existingSqlQuery);

		await expect(
			createCaller().sql.updateSemanticQuery({ queryId: 'query_1', query: { metrics: ['revenue'] } }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateSemanticQueryPart).not.toHaveBeenCalled();
	});

	it('refuses an empty metric list', async () => {
		await expect(
			createCaller().sql.updateSemanticQuery({ queryId: 'query_1', query: { metrics: [] } }),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Test User', email: 'test@example.com' } },
		selectedProjectId: null,
	} as never);
}
