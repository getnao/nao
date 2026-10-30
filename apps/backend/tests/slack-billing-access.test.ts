import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../src/services/slack';
import type { ConversationContext } from '../src/types/messaging-provider';

const slackHarness = vi.hoisted(() => ({
	billingAccess: vi.fn(),
	clearSlackMainThread: vi.fn(),
	CloudBillingSeatRestrictedError: class CloudBillingSeatRestrictedError extends Error {},
	ensureMessagingProviderUser: vi.fn(),
	getProjectById: vi.fn(),
	seatAccess: vi.fn(),
	usersInfo: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		users = { info: slackHarness.usersInfo };
	},
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/chat.queries', () => ({
	clearSlackMainThread: slackHarness.clearSlackMainThread,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectById: slackHarness.getProjectById,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: slackHarness.billingAccess,
	assertProjectUserCloudBillingAccess: slackHarness.seatAccess,
	CloudBillingSeatRestrictedError: slackHarness.CloudBillingSeatRestrictedError,
}));
vi.mock('../src/services/team-member', () => ({
	ensureMessagingProviderUser: slackHarness.ensureMessagingProviderUser,
}));
vi.mock('../src/utils/keyed-lock', () => ({ claimOnce: vi.fn().mockResolvedValue(true) }));

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

describe('ProjectSlackBot billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		slackHarness.billingAccess.mockRejectedValue(new Error('billing restricted'));
		slackHarness.clearSlackMainThread.mockResolvedValue([]);
		slackHarness.getProjectById.mockResolvedValue({ name: 'Project' });
		slackHarness.seatAccess.mockResolvedValue(undefined);
		slackHarness.ensureMessagingProviderUser.mockResolvedValue({
			user: { id: 'user-1' },
			role: 'user',
			outcome: { status: 'activated', role: 'user', usedExistingSeat: true },
		});
		slackHarness.usersInfo.mockResolvedValue({
			user: { id: 'slack-user', profile: { email: 'user@example.com' } },
		});
	});

	it('reports full seat capacity after auto-provisioning the sender as a viewer', async () => {
		slackHarness.billingAccess.mockResolvedValue(undefined);
		slackHarness.ensureMessagingProviderUser.mockResolvedValue({
			user: { id: 'user-1' },
			role: 'viewer',
			outcome: { status: 'viewer_fallback', role: 'viewer', reason: 'capacity_full' },
		});
		const bot = new ProjectSlackBot(config);
		const post = vi.fn();
		const thread = {
			id: 'slack:C123:1700000000.000100',
			post,
		} as unknown as ConversationContext['thread'];
		const userMessage = {
			text: 'question',
			author: { userId: 'slack-user' },
		} as ConversationContext['userMessage'];

		await expect(
			bot['_handleWorkFlow'](thread, userMessage, { fetchUnseenMessages: false }),
		).resolves.toBeUndefined();

		expect(post).toHaveBeenCalledWith("❌ Your organization's seats are full. Ask an administrator to add a seat.");
	});

	it('checks billing before validating and auto-provisioning a message sender', async () => {
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

		expect(slackHarness.billingAccess).toHaveBeenCalledWith('project-1');
		expect(slackHarness.usersInfo).not.toHaveBeenCalled();
		expect(slackHarness.ensureMessagingProviderUser).not.toHaveBeenCalled();
		expect(thread.post).toHaveBeenCalledOnce();
	});

	it('continues validating and auto-provisioning a message sender when billing is granted', async () => {
		slackHarness.billingAccess.mockResolvedValue(undefined);
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

		expect(slackHarness.billingAccess).toHaveBeenCalledWith('project-1');
		expect(slackHarness.usersInfo).toHaveBeenCalledWith({ user: 'slack-user' });
		expect(slackHarness.getProjectById).toHaveBeenCalledWith('project-1');
		expect(slackHarness.ensureMessagingProviderUser).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'user@example.com', projectId: 'project-1' }),
		);
	});

	it('checks billing before authorizing and auto-provisioning a slash-command sender', async () => {
		const bot = new ProjectSlackBot(config);
		const postEphemeral = vi.fn();
		const event = {
			channel: {
				toJSON: () => ({ id: 'slack:C123' }),
				postEphemeral,
			},
			text: '',
			user: { userId: 'slack-user' },
		};

		await bot['_handleNewCommand'](event as never);

		expect(slackHarness.billingAccess).toHaveBeenCalledWith('project-1');
		expect(slackHarness.usersInfo).not.toHaveBeenCalled();
		expect(slackHarness.ensureMessagingProviderUser).not.toHaveBeenCalled();
		expect(slackHarness.clearSlackMainThread).not.toHaveBeenCalled();
		expect(postEphemeral).toHaveBeenCalledOnce();
	});
});
