import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	executeQuery: vi.fn(),
	extractToolCalls: vi.fn(() => []),
	getAzureAccessTokenForUser: vi.fn(),
	getEnvVars: vi.fn(),
	hasFeature: vi.fn(),
	resolveProjectContextAccess: vi.fn(),
	retrieveProjectById: vi.fn(),
	runTest: vi.fn(),
	runVerification: vi.fn(),
}));

vi.mock('../src/agents/tools/execute-sql', () => ({
	executeQuery: mocks.executeQuery,
}));
vi.mock('../src/middleware/auth', () => ({
	authMiddleware: vi.fn(),
}));
vi.mock('../src/queries/project.queries', () => ({
	getEnvVars: mocks.getEnvVars,
	retrieveProjectById: mocks.retrieveProjectById,
}));
vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { sso: 'sso' },
}));
vi.mock('../src/services/microsoft-auth.service', () => ({
	getAzureAccessTokenForUser: mocks.getAzureAccessTokenForUser,
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
			userGroupFeatures: [],
			userRulesGroupAccess: { enforced: true, groupNames: ['analysts'] },
		});
		mocks.getEnvVars.mockResolvedValue({ WAREHOUSE_HOST: 'warehouse.example.com' });
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
		mocks.runVerification.mockResolvedValue({ matches: true });
	});

	it('uses project credentials while keeping expected-query verification restricted', async () => {
		const reply = await runExpectedQuery();

		expect(mocks.retrieveProjectById).toHaveBeenCalledWith('project-id');
		expect(mocks.getEnvVars).toHaveBeenCalledWith('project-id');
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
				adminMode: false,
				envVars: { WAREHOUSE_HOST: 'warehouse.example.com' },
				azureAccessToken: 'azure-access-token',
				warehouseTableAccess: { enforced: true },
				warehouseRowSecurity: { enforced: false },
				docsContextAccess: { enforced: false },
				userGroupFeatures: [],
				userRulesGroupAccess: { enforced: true, groupNames: ['analysts'] },
				queryResults: new Map(),
				generatedArtifacts: { charts: [], maps: [], stories: [] },
			},
		);
		expect(reply.status).not.toHaveBeenCalled();
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
});

async function runExpectedQuery() {
	let handler: (request: unknown, reply: unknown) => Promise<unknown> = async () => {};
	const app = {
		addHook: vi.fn(),
		post: vi.fn((_path, _options, routeHandler) => {
			handler = routeHandler;
		}),
	};
	await testRoutes(app as never);
	const reply = createReply();

	await handler(
		{
			project: { id: 'project-id' },
			user: { id: 'user-id' },
			body: {
				prompt: 'Question',
				sql: 'SELECT 1',
				databaseId: 'warehouse',
			},
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
