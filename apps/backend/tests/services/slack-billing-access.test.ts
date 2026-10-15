import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectSlackBot } from '../../src/services/slack';
import type { ConversationContext } from '../../src/types/messaging-provider';
import { createSlackConfig } from '../helpers/slack-config';

const slackHarness = vi.hoisted(() => ({
	billingAccess: vi.fn(),
	clearSlackMainThread: vi.fn(),
	ensureMessagingProviderUser: vi.fn(),
	getProjectById: vi.fn(),
	usersInfo: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		users = { info: slackHarness.usersInfo };
	},
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	clearSlackMainThread: slackHarness.clearSlackMainThread,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: slackHarness.getProjectById,
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: slackHarness.billingAccess,
}));
vi.mock('../../src/services/team-member', () => ({
	ensureMessagingProviderUser: slackHarness.ensureMessagingProviderUser,
}));

const config = createSlackConfig({ autoCreateUsersEnabled: true, autoCreateUsersDomains: ['example.com'] });

describe('ProjectSlackBot billing access', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		slackHarness.billingAccess.mockRejectedValue(new Error('billing restricted'));
		slackHarness.clearSlackMainThread.mockResolvedValue([]);
		slackHarness.getProjectById.mockResolvedValue({ name: 'Project' });
		slackHarness.usersInfo.mockResolvedValue({
			user: { id: 'slack-user', profile: { email: 'user@example.com' } },
		});
	});

	it('checks billing before validating and auto-provisioning a message sender', async () => {
		const thread = await handleQuestion();

		expect(slackHarness.billingAccess).toHaveBeenCalledWith('project-1');
		expect(slackHarness.usersInfo).not.toHaveBeenCalled();
		expect(slackHarness.ensureMessagingProviderUser).not.toHaveBeenCalled();
		expect(thread.post).toHaveBeenCalledOnce();
	});

	it('continues validating and auto-provisioning a message sender when billing is granted', async () => {
		slackHarness.billingAccess.mockResolvedValue(undefined);

		await handleQuestion();

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

async function handleQuestion(): Promise<ConversationContext['thread']> {
	const thread = {
		id: 'slack:C123:1700000000.000100',
		post: vi.fn(),
	} as unknown as ConversationContext['thread'];
	const userMessage = {
		text: 'question',
		author: { userId: 'slack-user' },
	} as ConversationContext['userMessage'];

	await new ProjectSlackBot(config)['_handleWorkFlow'](thread, userMessage, { fetchUnseenMessages: false });
	return thread;
}
