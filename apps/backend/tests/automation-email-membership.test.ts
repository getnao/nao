import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../src/types/tools';

const mocks = vi.hoisted(() => ({
	membershipRevoked: false,
	getNonMemberRecipients: vi.fn(),
	getDisplaySettings: vi.fn(),
	sendEmail: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/custom-story', () => ({ getActiveThemeForProject: vi.fn(async () => null) }));
vi.mock('../src/services/automation-email-policy', () => ({
	getNonMemberAutomationEmailRecipients: mocks.getNonMemberRecipients,
}));
vi.mock('../src/queries/project.queries', () => ({
	getDisplaySettings: mocks.getDisplaySettings,
}));
vi.mock('../src/services/email', () => ({
	emailService: {
		isEnabled: () => true,
		sendEmail: mocks.sendEmail,
	},
}));

import { createAutomationTools } from '../src/services/automation-tools';

const RECIPIENT = 'member@example.com';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.membershipRevoked = false;
	mocks.getNonMemberRecipients.mockImplementation(async () => (mocks.membershipRevoked ? [RECIPIENT] : []));
	mocks.getDisplaySettings.mockImplementation(async () => {
		mocks.membershipRevoked = true;
		return { dateFormat: null };
	});
});

describe('send_automation_email membership', () => {
	it('rechecks membership after rendering attachments', async () => {
		const tool = createAutomationTools({
			projectId: 'project-1',
			chatId: 'chat-1',
			githubToken: null,
			integrations: { email: { enabled: true, recipients: [RECIPIENT] } },
		}).send_automation_email;

		await expect(runTool(tool, { recipients: [], text: 'Report' }, emptyContext())).rejects.toThrow(
			`these recipients aren't members of this project: ${RECIPIENT}`,
		);
		expect(mocks.getNonMemberRecipients).toHaveBeenCalledTimes(2);
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});

function emptyContext(): ToolContext {
	return {
		projectFolder: '/tmp',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: null,
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTool(tool: any, input: Record<string, unknown>, context: ToolContext) {
	return tool.execute(input, { experimental_context: context, toolCallId: 'call-1', messages: [] });
}
