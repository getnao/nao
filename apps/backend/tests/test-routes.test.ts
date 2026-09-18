import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildToolContext: vi.fn(),
	executeQuery: vi.fn(),
	extractToolCalls: vi.fn(() => []),
	runTest: vi.fn(),
	runVerification: vi.fn(),
}));

vi.mock('../src/agents/tools/execute-sql', () => ({
	executeQuery: mocks.executeQuery,
}));
vi.mock('../src/middleware/auth', () => ({
	authMiddleware: vi.fn(),
}));
vi.mock('../src/services/agent', () => ({
	buildToolContext: mocks.buildToolContext,
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
	it('forces expected-query verification to use read-only agent settings', async () => {
		const toolContext = { agentSettings: null };
		mocks.buildToolContext.mockResolvedValue(toolContext);
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

		expect(mocks.buildToolContext).toHaveBeenCalledWith({
			projectId: 'project-id',
			userId: 'user-id',
			chatId: '',
			agentSettings: null,
			supportsCustomCharts: false,
		});
		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'SELECT 1', database_id: 'warehouse' },
			toolContext,
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
