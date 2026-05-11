import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	executeQuery: vi.fn(),
	getToolCallForRerun: vi.fn(),
	upsertMessage: vi.fn(),
	getUserRoleInProject: vi.fn(),
	retrieveProjectById: vi.fn(),
	getAgentSettings: vi.fn(),
	getEnvVars: vi.fn(),
	hasFeature: vi.fn(),
	getAzureAccessTokenForUser: vi.fn(),
}));

vi.mock('../src/agents/tools/execute-sql', () => ({
	executeQuery: mocks.executeQuery,
}));

vi.mock('../src/queries/chat.queries', () => ({
	getChatOwnerId: vi.fn(),
	getToolCallForRerun: mocks.getToolCallForRerun,
	upsertMessage: mocks.upsertMessage,
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
	retrieveProjectById: mocks.retrieveProjectById,
	getAgentSettings: mocks.getAgentSettings,
	getEnvVars: mocks.getEnvVars,
	getProjectByUserId: vi.fn(),
}));

vi.mock('../src/services/license.service', () => ({
	LICENSE_FEATURES: { sso: 'sso' },
	hasFeature: mocks.hasFeature,
}));

vi.mock('../src/services/microsoft-auth.service', () => ({
	getAzureAccessTokenForUser: mocks.getAzureAccessTokenForUser,
}));

vi.mock('../src/services/agent', () => ({
	agentService: { get: vi.fn() },
}));

vi.mock('../src/services/posthog', () => ({
	PostHogEvent: {},
	posthog: { capture: vi.fn() },
}));

vi.mock('../src/auth', () => ({
	getAuth: vi.fn(),
}));

vi.mock('../src/utils/chat-context-usage', () => ({
	getChatContextUsage: vi.fn(),
}));

import { chatRoutes } from '../src/trpc/chat.routes';
import { router } from '../src/trpc/trpc';

const caller = () =>
	router({ chat: chatRoutes }).createCaller({
		session: {
			user: { id: 'user-1', email: 'user@example.com', name: 'User' },
		},
		selectedProjectId: 'project-1',
	});

describe('chat.rerunExecuteSqlToolCall', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getToolCallForRerun.mockResolvedValue({
			chatId: 'chat-1',
			projectId: 'project-1',
			userId: 'user-1',
			toolName: 'execute_sql',
			toolState: 'output-available',
			toolInput: { sql_query: 'select 1 as value', database_id: 'warehouse' },
		});
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.retrieveProjectById.mockResolvedValue({ id: 'project-1', path: '/workspace/project' });
		mocks.getAgentSettings.mockResolvedValue({ sql: { dangerouslyWritePermEnabled: false } });
		mocks.getEnvVars.mockResolvedValue({ FOO: 'bar' });
		mocks.hasFeature.mockResolvedValue(false);
		mocks.executeQuery.mockResolvedValue({
			_version: '1',
			id: 'query_12345678',
			columns: ['value'],
			data: [{ value: 1 }],
			row_count: 1,
		});
		mocks.upsertMessage.mockResolvedValue({ messageId: 'message-1' });
	});

	it('reruns a stored successful SQL tool call and appends the fresh result', async () => {
		await expect(caller().chat.rerunExecuteSqlToolCall({ toolCallId: 'tool-call-1' })).resolves.toEqual({
			chatId: 'chat-1',
			messageId: 'message-1',
		});

		expect(mocks.executeQuery).toHaveBeenCalledWith(
			{ sql_query: 'select 1 as value', database_id: 'warehouse' },
			expect.objectContaining({
				projectFolder: '/workspace/project',
				chatId: 'chat-1',
				agentSettings: { sql: { dangerouslyWritePermEnabled: false } },
				envVars: { FOO: 'bar' },
				azureAccessToken: null,
				queryResults: expect.any(Map),
			}),
		);
		expect(mocks.upsertMessage).toHaveBeenCalledWith({
			chatId: 'chat-1',
			role: 'assistant',
			parts: [
				expect.objectContaining({
					type: 'tool-execute_sql',
					state: 'output-available',
					input: { sql_query: 'select 1 as value', database_id: 'warehouse' },
					output: expect.objectContaining({ id: 'query_12345678', row_count: 1 }),
					toolCallId: expect.any(String),
				}),
			],
		});
	});

	it('rejects viewers before executing SQL', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		await expect(caller().chat.rerunExecuteSqlToolCall({ toolCallId: 'tool-call-1' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Viewers cannot rerun tool calls.',
		});

		expect(mocks.executeQuery).not.toHaveBeenCalled();
		expect(mocks.upsertMessage).not.toHaveBeenCalled();
	});
});
