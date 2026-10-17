import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../src/services/slack';
import type { ConversationContext } from '../src/types/messaging-provider';

const slackHarness = vi.hoisted(() => ({
	chatPostMessage: vi.fn(),
	chatUpdate: vi.fn(),
	ensureMessagingProviderUser: vi.fn(),
	getAppName: vi.fn(),
	getChatBySlackThread: vi.fn(),
	usersInfo: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		users = { info: slackHarness.usersInfo };
		chat = { postMessage: slackHarness.chatPostMessage, update: slackHarness.chatUpdate };
	},
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	getChatBySlackThread: slackHarness.getChatBySlackThread,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectById: vi.fn().mockResolvedValue({ name: 'Project' }),
}));
vi.mock('../src/services/branding.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/branding.service')>()),
	getAppName: slackHarness.getAppName,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/services/team-member', () => ({
	ensureMessagingProviderUser: slackHarness.ensureMessagingProviderUser,
}));

const config: SlackConfig = {
	projectId: 'project-1',
	botToken: 'xoxb-test',
	signingSecret: 'secret',
	redirectUrl: 'https://nao.example.com/',
	autoCreateUsersEnabled: true,
	autoCreateUsersDomains: ['example.com'],
	transportMode: 'webhook',
	appToken: '',
	replyMode: 'thread',
	dmScopeMissing: false,
};

describe('ProjectSlackBot answering status', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		slackHarness.usersInfo.mockResolvedValue({
			user: { id: 'slack-user', profile: { email: 'user@example.com' } },
		});
		slackHarness.ensureMessagingProviderUser.mockResolvedValue({ id: 'user-1' });
		slackHarness.chatPostMessage.mockResolvedValue({ ok: true, ts: '1700000000.000200' });
		slackHarness.chatUpdate.mockResolvedValue({ ok: true });
		slackHarness.getChatBySlackThread.mockRejectedValue(new Error('stop after placeholder'));
	});

	it.each([
		['Acme Analytics', '✨ Acme Analytics is answering...'],
		['nao', '✨ nao is answering...'],
	])('shows "%s" in the placeholder card', async (appName, expectedStatus) => {
		slackHarness.getAppName.mockResolvedValue(appName);
		const bot = new ProjectSlackBot(config);
		const thread = {
			id: 'slack:C123:1700000000.000100',
			post: vi.fn(),
		} as unknown as ConversationContext['thread'];
		const userMessage = {
			text: 'question',
			author: { userId: 'slack-user' },
		} as ConversationContext['userMessage'];

		await bot['_handleWorkFlow'](thread, userMessage, { fetchUnseenMessages: false });

		const placeholder = slackHarness.chatPostMessage.mock.calls[0][0];
		expect(placeholder.text).toBe(expectedStatus);
		expect(JSON.stringify(placeholder.blocks)).toContain(expectedStatus);
	});
});
