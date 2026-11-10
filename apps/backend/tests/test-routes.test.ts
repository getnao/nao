import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	executeQuery: vi.fn(),
	extractToolCalls: vi.fn(() => []),
	getAgentSettings: vi.fn(),
	getAzureAccessTokenForUser: vi.fn(),
	getMcpEndpointSettings: vi.fn(),
	getUserRoleInProject: vi.fn(),
	getProjectRuntimeEnvVars: vi.fn(),
	hasFeature: vi.fn(),
	resolveProjectContextAccess: vi.fn(),
	resolveSemanticLayerMode: vi.fn(),
	retrieveProjectById: vi.fn(),
	runTest: vi.fn(),
	runVerification: vi.fn(),
	evaluateExternalTestAttempt: vi.fn(),
	createExternalTestAttemptToken: vi.fn(),
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
vi.mock('../src/queries/mcp-endpoint.queries', () => ({
	getMcpEndpointSettings: mocks.getMcpEndpointSettings,
}));
vi.mock('../src/services/external-test-evaluation.service', () => ({
	evaluateExternalTestAttempt: mocks.evaluateExternalTestAttempt,
}));
vi.mock('../src/services/external-test-attempt-token', () => ({
	createExternalTestAttemptToken: mocks.createExternalTestAttemptToken,
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
		mocks.getMcpEndpointSettings.mockResolvedValue({
			enabled: true,
			subAgentModeEnabled: false,
			contextLayerModeEnabled: true,
		});
		mocks.createExternalTestAttemptToken.mockReturnValue({
			id: '00000000-0000-4000-8000-000000000001',
			token: 'nao_test_token',
			expiresAt: new Date('2026-01-01T01:00:00Z'),
		});
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

	it('runs the model at the reasoning effort the CLI asks for', async () => {
		await runExpectedQuery({
			prompt: 'Question',
			model: { provider: 'openai', modelId: 'gpt-5', reasoningEffort: 'high' },
		});

		expect(mocks.runTest).toHaveBeenCalledWith(
			'project-id',
			'user-id',
			'Question',
			{ provider: 'openai', modelId: 'gpt-5', reasoningEffort: 'high' },
			undefined,
		);
	});

	it('rejects a reasoning effort the model does not support', async () => {
		const reply = await runExpectedQuery({
			prompt: 'Question',
			model: { provider: 'openai', modelId: 'gpt-4.1', reasoningEffort: 'high' },
		});

		expect(reply.status).toHaveBeenCalledWith(400);
		expect(reply.send).toHaveBeenCalledWith({
			error: 'openai:gpt-4.1 cannot run at the reasoning effort high, expected none, as it has no reasoning efforts.',
		});
		expect(mocks.runTest).not.toHaveBeenCalled();
	});

	it('lists the reasoning efforts of a model for the CLI', async () => {
		const reply = createReply();
		const app = { addHook: vi.fn(), post: vi.fn(), get: vi.fn() };
		await testRoutes(app as never);
		const [, options, handler] = app.get.mock.calls.find(([routePath]) => routePath === '/reasoning-efforts')!;

		await handler({ query: options.schema.querystring.parse({ provider: 'openai', modelId: 'gpt-5' }) }, reply);

		expect(reply.send).toHaveBeenCalledWith({ reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'max'] });
	});

	it('rejects project viewers before running a test', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		const reply = await runExpectedQuery({ prompt: 'Question' });

		expect(reply.status).toHaveBeenCalledWith(403);
		expect(mocks.runTest).not.toHaveBeenCalled();
	});

	it('starts an external context-layer attempt with a scoped MCP credential', async () => {
		const { handler, reply } = await registeredPost('/external/start');

		await handler({ project: { id: 'project-id' }, user: { id: 'user-id' }, host: 'nao.example.com' }, reply);

		expect(reply.send).toHaveBeenCalledWith({
			attemptId: '00000000-0000-4000-8000-000000000001',
			mcpUrl: expect.stringMatching(/\/mcp\/project-id$/),
			accessToken: 'nao_test_token',
			expiresAt: '2026-01-01T01:00:00.000Z',
		});
	});

	it('requires context-layer mode for an external attempt', async () => {
		mocks.getMcpEndpointSettings.mockResolvedValue({
			enabled: true,
			subAgentModeEnabled: true,
			contextLayerModeEnabled: false,
		});
		const { handler, reply } = await registeredPost('/external/start');

		await handler({ project: { id: 'project-id' }, user: { id: 'user-id' }, host: 'nao.example.com' }, reply);

		expect(reply.status).toHaveBeenCalledWith(400);
		expect(mocks.createExternalTestAttemptToken).not.toHaveBeenCalled();
	});

	it('returns the captured external run after nao evaluates it', async () => {
		mocks.evaluateExternalTestAttempt.mockResolvedValue({
			status: 'complete',
			toolCalls: [{ toolName: 'execute_sql', toolCallId: 'call-1', args: {} }],
			verification: undefined,
			verdict: { passed: true, message: 'tool_call: execute_sql', comparison: null },
		});
		const { handler, bodySchema, reply } = await registeredPost('/external/evaluate');
		const body = bodySchema.parse({
			attemptId: '00000000-0000-4000-8000-000000000001',
			prompt: 'Revenue?',
			answer: '10',
			assertions: [{ type: 'tool_call', tool: 'execute_sql' }],
			run: { usage: { totalTokens: 3 }, cost: { totalCost: null }, finishReason: 'stop', durationMs: 5 },
		});

		await handler({ project: { id: 'project-id' }, user: { id: 'user-id' }, body }, reply);

		expect(reply.send).toHaveBeenCalledWith({
			status: 'complete',
			text: '10',
			toolCalls: [{ toolName: 'execute_sql', toolCallId: 'call-1', args: {} }],
			usage: { totalTokens: 3 },
			cost: { totalCost: null },
			finishReason: 'stop',
			durationMs: 5,
			verification: undefined,
			verdict: { passed: true, message: 'tool_call: execute_sql', comparison: null },
		});
	});
});

async function runExpectedQuery(
	body: Record<string, unknown> = { prompt: 'Question', sql: 'SELECT 1', databaseId: 'warehouse' },
) {
	let handler: (request: unknown, reply: unknown) => Promise<unknown> = async () => {};
	let bodySchema: { parse: (value: unknown) => unknown } | undefined;
	const app = {
		addHook: vi.fn(),
		get: vi.fn(),
		post: vi.fn((path, options, routeHandler) => {
			if (path === '/run') {
				handler = routeHandler;
				bodySchema = options.schema.body;
			}
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

async function registeredPost(path: string) {
	const app = { addHook: vi.fn(), get: vi.fn(), post: vi.fn() };
	await testRoutes(app as never);
	const registration = app.post.mock.calls.find(([routePath]) => routePath === path)!;
	const handler = registration.length === 2 ? registration[1] : registration[2];
	const bodySchema = registration.length === 2 ? undefined : registration[1].schema.body;
	return { handler, bodySchema, reply: createReply() };
}

function createReply() {
	const reply = {
		status: vi.fn(),
		send: vi.fn((body) => body),
	};
	reply.status.mockReturnValue(reply);
	return reply;
}
