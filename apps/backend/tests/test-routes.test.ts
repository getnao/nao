import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	executeQuery: vi.fn(),
	extractToolCalls: vi.fn(() => []),
	getAgentSettings: vi.fn(),
	getAzureAccessTokenForUser: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getProjectRuntimeEnvVars: vi.fn(),
	hasFeature: vi.fn(),
	resolveProjectContextAccess: vi.fn(),
	resolveSemanticLayerMode: vi.fn(),
	retrieveProjectById: vi.fn(),
	runTest: vi.fn(),
	runVerification: vi.fn(),
}));

vi.mock('../src/agents/tools/execute-sql', () => ({
	executeQuery: mocks.executeQuery,
}));
vi.mock('../src/middleware/auth', () => ({
	sessionOrApiKeyAuthMiddleware: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getAgentSettings: mocks.getAgentSettings,
	getUserRoleInProject: mocks.getUserRoleInProject,
	retrieveProjectById: mocks.retrieveProjectById,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../src/services/microsoft-auth.service', () => ({
	getAzureAccessTokenForUser: mocks.getAzureAccessTokenForUser,
}));
vi.mock('../src/services/project-runtime-env', () => ({
	getProjectRuntimeEnvVars: mocks.getProjectRuntimeEnvVars,
}));
vi.mock('../src/services/semantic-layer.service', () => ({
	resolveSemanticLayerMode: mocks.resolveSemanticLayerMode,
}));
vi.mock('../src/services/user-group-context-access.service', () => ({
	resolveProjectContextAccess: mocks.resolveProjectContextAccess,
}));
vi.mock('../src/services/test-agent.service', () => ({
	TestAgentService: class TestAgentService {
		static extractToolCalls = mocks.extractToolCalls;
	},
	testAgentService: {
		runTest: mocks.runTest,
		runVerification: mocks.runVerification,
	},
}));

import { testRoutes } from '../src/routes/test';

describe('test routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.retrieveProjectById.mockResolvedValue({ path: '/project' });
		mocks.resolveProjectContextAccess.mockResolvedValue({
			warehouseTableAccess: { enforced: true },
			warehouseRowSecurity: { enforced: false },
			docsContextAccess: { enforced: false },
			filesContextAccess: { enforced: false },
			mcpAccess: { mode: 'all' },
			userGroupFeatures: [],
			userRulesGroupAccess: { enforced: true, groupNames: ['analysts'] },
		});
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.getAgentSettings.mockResolvedValue({ semanticLayer: { mode: 'exclusive' } });
		mocks.resolveSemanticLayerMode.mockReturnValue('exclusive');
		mocks.getProjectRuntimeEnvVars.mockResolvedValue({
			WAREHOUSE_HOST: 'warehouse.example.com',
			WAREHOUSE_PASSWORD: 'encrypted-storage-secret',
		});
		mocks.hasFeature.mockResolvedValue(true);
		mocks.getAzureAccessTokenForUser.mockResolvedValue('azure-access-token');
		mocks.executeQuery.mockResolvedValue({ data: [], columns: [] });
		mocks.runTest.mockResolvedValue({
			text: 'answer',
			usage: {},
			cost: 0,
			finishReason: 'stop',
			durationMs: 1,
		});
		mocks.runVerification.mockResolvedValue({ data: [], sql: null, error: null });
	});

	it('returns the verdict computed from the assertions and the verified data', async () => {
		mocks.executeQuery.mockResolvedValue({ data: [{ total: 10 }], columns: ['total'] });
		mocks.runVerification.mockResolvedValue({ data: [{ total: '10' }], sql: 'SELECT total FROM q1', error: null });
		mocks.extractToolCalls.mockReturnValueOnce([{ toolName: 'execute_sql', toolCallId: '1', args: {} }] as never);

		const reply = await runExpectedQuery({
			prompt: 'Question',
			sql: 'SELECT 10 AS total',
			assertions: [{ type: 'tool_call', tool: 'execute_sql' }],
		});

		expect(reply.send).toHaveBeenCalledWith(
			expect.objectContaining({
				verdict: { passed: true, message: 'tool_call: execute_sql; match', comparison: null },
			}),
		);
	});

	it('sends the verification without the fields released CLIs do not know', async () => {
		mocks.executeQuery.mockResolvedValue({ data: [{ total: 10 }], columns: ['total'] });
		mocks.runVerification.mockResolvedValue({
			data: [{ total: 10 }],
			sql: 'SELECT total FROM query_1',
			sourceQueries: [{ id: 'query_1', sql: 'SELECT 10 AS total' }],
			error: null,
		});

		const reply = await runExpectedQuery();

		expect(reply.send).toHaveBeenCalledWith(
			expect.objectContaining({
				verification: {
					data: [{ total: 10 }],
					expectedData: [{ total: 10 }],
					expectedColumns: ['total'],
					sql: 'SELECT total FROM query_1',
					error: null,
				},
			}),
		);
	});

	it('uses project credentials while keeping expected-query verification restricted', async () => {
		const reply = await runExpectedQuery();

		expect(mocks.retrieveProjectById).toHaveBeenCalledWith('project-id');
		expect(mocks.getProjectRuntimeEnvVars).toHaveBeenCalledWith('project-id');
		expect(mocks.hasFeature).toHaveBeenCalledWith('sso');
		expect(mocks.getAzureAccessTokenForUser).toHaveBeenCalledWith('user-id');
		expect(mocks.resolveProjectContextAccess).toHaveBeenCalledWith('project-id', 'user-id', '/project');
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			{
				projectFolder: '/project',
				chatId: '',
				userId: 'user-id',
				projectId: 'project-id',
				supportsCustomCharts: false,
				agentSettings: null,
				semanticLayerMode: 'exclusive',
				adminMode: false,
				envVars: {
					WAREHOUSE_HOST: 'warehouse.example.com',
					WAREHOUSE_PASSWORD: 'encrypted-storage-secret',
				},
				azureAccessToken: 'azure-access-token',
				warehouseTableAccess: { enforced: true },
				warehouseRowSecurity: { enforced: false },
				docsContextAccess: { enforced: false },
				filesContextAccess: { enforced: false },
				mcpAccess: { mode: 'all' },
				userGroupFeatures: [],
				userRulesGroupAccess: { enforced: true, groupNames: ['analysts'] },
				queryResults: new Map(),
				generatedArtifacts: { charts: [], maps: [], stories: [] },
			},
		);
		expect(reply.status).not.toHaveBeenCalled();
	});

	it('keeps the reference SQL of users within the semantic layer mode of the project', async () => {
		await runExpectedQuery();

		expect(mocks.resolveSemanticLayerMode).toHaveBeenCalledWith('/project', {
			semanticLayer: { mode: 'exclusive' },
		});
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			expect.objectContaining({ semanticLayerMode: 'exclusive' }),
		);
	});

	it.each(['admin', 'context_admin'])('lets the reference SQL of a %s reach the warehouse', async (role) => {
		mocks.getUserRoleInProject.mockResolvedValue(role);

		await runExpectedQuery();

		expect(mocks.resolveSemanticLayerMode).not.toHaveBeenCalled();
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			expect.objectContaining({ semanticLayerMode: null }),
		);
	});

	it('does not load Azure credentials without an SSO license', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		await runExpectedQuery();

		expect(mocks.getAzureAccessTokenForUser).not.toHaveBeenCalled();
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			expect.objectContaining({ azureAccessToken: null }),
		);
	});

	it('skips SQL verification when the request omits reference sql', async () => {
		const reply = await runExpectedQuery({ prompt: 'Question' });

		expect(mocks.runTest).toHaveBeenCalledWith(
			'project-id',
			'user-id',
			'Question',
			{ provider: 'openai', modelId: 'gpt-4.1' },
			undefined,
		);
		expect(mocks.retrieveProjectById).not.toHaveBeenCalled();
		expect(mocks.executeQuery).not.toHaveBeenCalled();
		expect(mocks.runVerification).not.toHaveBeenCalled();
		expect(reply.status).not.toHaveBeenCalled();
		expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ text: 'answer', verification: undefined }));
	});

	it('rejects project viewers before running a test', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		const reply = await runExpectedQuery({ prompt: 'Question' });

		expect(reply.status).toHaveBeenCalledWith(403);
		expect(mocks.runTest).not.toHaveBeenCalled();
	});
});

async function runExpectedQuery(
	body: Record<string, unknown> = { prompt: 'Question', sql: 'SELECT 1', databaseId: 'warehouse' },
) {
	let handler: (request: unknown, reply: unknown) => Promise<unknown> = async () => {};
	let bodySchema: { parse: (value: unknown) => unknown } | undefined;
	const app = {
		addHook: vi.fn(),
		post: vi.fn((_path, options, routeHandler) => {
			handler = routeHandler;
			bodySchema = options.schema.body;
		}),
	};
	await testRoutes(app as never);
	const reply = createReply();

	await handler(
		{
			project: { id: 'project-id' },
			user: { id: 'user-id' },
			body: bodySchema?.parse({ model: { provider: 'openai', modelId: 'gpt-4.1' }, ...body }),
		},
		reply,
	);

	return reply;
}

function createReply() {
	const reply = {
		status: vi.fn(),
		send: vi.fn((body) => body),
	};
	reply.status.mockReturnValue(reply);
	return reply;
}
