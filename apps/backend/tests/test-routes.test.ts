import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	executeQuery: vi.fn(),
	extractToolCalls: vi.fn(() => []),
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
	retrieveProjectById: mocks.retrieveProjectById,
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
	it('uses explicit settings and resolved context access for expected-query verification', async () => {
		const warehouseTableAccess = { enforced: true };
		const warehouseRowSecurity = { enforced: false };
		mocks.retrieveProjectById.mockResolvedValue({ path: '/project' });
		mocks.resolveProjectContextAccess.mockResolvedValue({
			warehouseTableAccess,
			warehouseRowSecurity,
			docsContextAccess: { enforced: false },
			userGroupFeatures: [],
			userRulesGroupAccess: { enforced: true, groupNames: ['analysts'] },
		});
		mocks.executeQuery.mockResolvedValue({ data: [], columns: [] });
		mocks.runTest.mockResolvedValue({
			text: 'answer',
			usage: {},
			cost: 0,
			finishReason: 'stop',
			durationMs: 1,
		});
		mocks.runVerification.mockResolvedValue({ matches: true });

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

		expect(mocks.retrieveProjectById).toHaveBeenCalledWith('project-id');
		expect(mocks.resolveProjectContextAccess).toHaveBeenCalledWith('project-id', 'user-id', '/project');
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			expect.objectContaining({
				projectFolder: '/project',
				chatId: '',
				userId: 'user-id',
				projectId: 'project-id',
				supportsCustomCharts: false,
				agentSettings: null,
				adminMode: false,
				envVars: {},
				azureAccessToken: null,
				warehouseTableAccess,
				warehouseRowSecurity,
			}),
		);
		expect(reply.status).not.toHaveBeenCalled();
	});
});

function createReply() {
	const reply = {
		status: vi.fn(),
		send: vi.fn((body) => body),
	};
	reply.status.mockReturnValue(reply);
	return reply;
}
