import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAutomationById: vi.fn(),
	createAutomationRun: vi.fn(),
	attachRunChat: vi.fn(),
	completeAutomationRun: vi.fn(),
	failAutomationRun: vi.fn(),
	createChat: vi.fn(),
	getChat: vi.fn(),
	getChatMessages: vi.fn(),
	getUser: vi.fn(),
	getGithubToken: vi.fn(),
	createAgent: vi.fn(),
}));

vi.mock('../src/queries/automation.queries', () => ({
	getAutomationById: mocks.getAutomationById,
	createAutomationRun: mocks.createAutomationRun,
	attachRunChat: mocks.attachRunChat,
	completeAutomationRun: mocks.completeAutomationRun,
	failAutomationRun: mocks.failAutomationRun,
}));
vi.mock('../src/queries/chat.queries', () => ({
	createChat: mocks.createChat,
	getChat: mocks.getChat,
	getChatMessages: mocks.getChatMessages,
	upsertMessage: vi.fn(),
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
	skillService: { initializeSkills: vi.fn() },
}));
vi.mock('../src/services/automation-tools', () => ({
	AUTOMATION_INTEGRATION_TOOL_NAMES: ['send_automation_email', 'send_automation_slack_message'],
	createAutomationTools: vi.fn(() => ({})),
	getAutomationIntegrationToolNames: vi.fn(() => ['send_automation_slack_message']),
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

describe('automation run integration results', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAutomationById.mockResolvedValue({
			id: 'automation-1',
			projectId: 'project-1',
			userId: 'user-1',
			title: 'Orders',
			prompt: 'Send orders',
			integrations: { slack: { enabled: true, channelId: 'C0123456789, #sales, sales team' } },
			mcpEnabled: false,
			modelProvider: null,
			modelId: null,
			timezone: null,
			enabled: true,
		});
		mocks.createAutomationRun.mockResolvedValue({ id: 'run-1', automationId: 'automation-1', status: 'running' });
		mocks.getUser.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
		mocks.createChat.mockResolvedValue([{ id: 'chat-1' }]);
		mocks.getChat.mockResolvedValue([{ id: 'chat-1', messages: [] }]);
		mocks.getGithubToken.mockResolvedValue(null);
		mocks.createAgent.mockResolvedValue({ stream: createEmptyStream });
	});

	it('records one Slack result per channel', async () => {
		mocks.getChatMessages.mockResolvedValue([
			{
				id: 'message-1',
				role: 'assistant',
				parts: [
					slackToolPart('call-1', {
						ok: true,
						threadId: 'slack:C0123456789:111.222',
						attachments: [],
						deliveries: [
							{ channel: 'C0123456789', ok: true, threadId: 'slack:C0123456789:111.222' },
							{ channel: '#sales', ok: false, error: 'not_in_channel' },
							{ channel: 'sales team', ok: false, error: 'Channel names cannot contain spaces.' },
						],
					}),
				],
			},
		]);

		await runAutomation('automation-1');

		expect(mocks.completeAutomationRun).toHaveBeenCalledWith('run-1', [
			{
				type: 'slack',
				label: 'send_automation_slack_message',
				ok: true,
				message: undefined,
				destination: 'C0123456789',
			},
			{
				type: 'slack',
				label: 'send_automation_slack_message',
				ok: false,
				message: 'not_in_channel',
				destination: '#sales',
			},
			{
				type: 'slack',
				label: 'send_automation_slack_message',
				ok: false,
				message: 'Channel names cannot contain spaces.',
				destination: 'sales team',
			},
		]);
	});
});

function createEmptyStream() {
	return new ReadableStream({
		start(controller) {
			controller.close();
		},
	});
}

function slackToolPart(toolCallId: string, output: unknown) {
	return {
		type: 'tool-send_automation_slack_message',
		toolCallId,
		state: 'output-available',
		input: { text: 'Weekly report' },
		output,
	};
}
