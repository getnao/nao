import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAutomationById: vi.fn(),
	createAutomationRun: vi.fn(),
	attachRunChat: vi.fn(),
	failAutomationRun: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	getUser: vi.fn(),
	getGithubToken: vi.fn(),
	createAgent: vi.fn(),
	initializeSkills: vi.fn(),
}));

vi.mock('../src/queries/automation.queries', () => ({
	getAutomationById: mocks.getAutomationById,
	createAutomationRun: mocks.createAutomationRun,
	attachRunChat: mocks.attachRunChat,
	failAutomationRun: mocks.failAutomationRun,
}));
vi.mock('../src/queries/chat.queries', () => ({
	createChat: mocks.createChat,
	getChat: mocks.getChat,
}));
vi.mock('../src/queries/user.queries', () => ({
	getUser: mocks.getUser,
	getGithubToken: mocks.getGithubToken,
}));
vi.mock('../src/services/agent', () => ({
	agentService: { create: mocks.createAgent },
}));
vi.mock('../src/services/mcp', () => ({
	mcpService: { initializeMcpState: vi.fn() },
}));
vi.mock('../src/services/skill', () => ({
	skillService: { initializeSkills: mocks.initializeSkills },
}));
vi.mock('../src/services/automation-tools', () => ({
	AUTOMATION_INTEGRATION_TOOL_NAMES: [],
	createAutomationTools: vi.fn(() => ({})),
	getAutomationIntegrationToolNames: vi.fn(() => []),
	isGithubAutomationTool: vi.fn(() => false),
}));
vi.mock('../src/agents/tools', () => ({
	getTools: vi.fn(() => ({})),
}));
vi.mock('../src/components/ai/automation-run-prompt', () => ({
	renderAutomationRunPrompt: vi.fn(() => 'run automation'),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn() },
}));

import { runAutomation } from '../src/handlers/automation.handler';

describe('automation owner project access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAutomationById.mockResolvedValue({
			id: 'automation-1',
			projectId: 'project-1',
			userId: 'removed-owner',
			title: 'Orders',
			prompt: 'Send orders',
			integrations: {},
			mcpEnabled: false,
			mcpServers: null,
			modelProvider: null,
			modelId: null,
			timezone: null,
			enabled: true,
		});
		mocks.createAutomationRun.mockResolvedValue({
			id: 'run-1',
			automationId: 'automation-1',
			status: 'running',
		});
		mocks.getUser.mockResolvedValue({
			id: 'removed-owner',
			email: 'removed@example.com',
		});
		mocks.createChat.mockResolvedValue([{ id: 'chat-1' }]);
		mocks.getChat.mockResolvedValue([{ id: 'chat-1', messages: [] }]);
		mocks.getGithubToken.mockResolvedValue(null);
		mocks.initializeSkills.mockResolvedValue(undefined);
		mocks.createAgent.mockRejectedValue(new Error('You do not have access to this project.'));
	});

	it('fails the run instead of changing principals after owner access is revoked', async () => {
		await expect(runAutomation('automation-1')).rejects.toThrow('access to this project');
		expect(mocks.createAgent).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'removed-owner', projectId: 'project-1' }),
			undefined,
			expect.any(Object),
		);
		expect(mocks.failAutomationRun).toHaveBeenCalledWith('run-1', 'You do not have access to this project.');
	});
});
