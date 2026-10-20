import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../../src/services/slack';

const slackHarness = vi.hoisted(() => ({
	authTest: vi.fn(),
	conversationsReplies: vi.fn(),
	startedWorkflows: vi.fn(),
	sharedClaims: new Set<string>(),
}));

vi.mock('@slack/web-api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@slack/web-api')>()),
	WebClient: class {
		conversations = { replies: slackHarness.conversationsReplies };
	},
}));
vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/chat.queries', () => ({
	getChat: vi.fn().mockResolvedValue([{ id: 'chat-1', messages: [] }]),
	getChatBySlackThread: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: slackHarness.startedWorkflows,
}));
vi.mock('../../src/utils/keyed-lock', () => ({
	claimOnce: vi.fn(async (key: string) => {
		if (slackHarness.sharedClaims.has(key)) {
			return false;
		}
		slackHarness.sharedClaims.add(key);
		return true;
	}),
}));

const SIGNING_SECRET = 'secret';
const BOT_USER_ID = 'U_BOT';
const MESSAGE_TS = '1760942786.000100';

const config: SlackConfig = {
	projectId: 'project-1',
	botToken: 'xoxb-test',
	signingSecret: SIGNING_SECRET,
	redirectUrl: 'https://nao.example.com/',
	autoCreateUsersEnabled: false,
	autoCreateUsersDomains: [],
	transportMode: 'socket',
	appToken: 'xapp-test',
	replyMode: 'thread',
	dmScopeMissing: false,
};

describe('Slack mention delivered as both `message` and `app_mention` events', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		slackHarness.sharedClaims.clear();
		slackHarness.startedWorkflows.mockResolvedValue(undefined);
		slackHarness.authTest.mockResolvedValue({ ok: true, user_id: BOT_USER_ID, bot_id: 'B_BOT', user: 'fibi' });
		slackHarness.conversationsReplies.mockResolvedValue({ ok: true, messages: [{ ts: MESSAGE_TS }] });
		stubWorkflowStepsAfterClaim();
	});

	it('answers once when both events reach the same pod', async () => {
		const pod = new ProjectSlackBot(config);

		await deliver(pod, 'app_mention');
		await deliver(pod, 'message');

		expect(slackHarness.startedWorkflows).toHaveBeenCalledTimes(1);
	});

	it('answers once when the two events reach different pods', async () => {
		const firstPod = new ProjectSlackBot(config);
		const secondPod = new ProjectSlackBot(config);

		await deliver(firstPod, 'app_mention');
		await deliver(secondPod, 'message');

		expect(slackHarness.startedWorkflows).toHaveBeenCalledTimes(1);
	});

	it('answers each distinct message', async () => {
		const firstPod = new ProjectSlackBot(config);
		const secondPod = new ProjectSlackBot(config);

		await deliver(firstPod, 'app_mention');
		await deliver(secondPod, 'app_mention', { ts: '1760942799.000200' });

		expect(slackHarness.startedWorkflows).toHaveBeenCalledTimes(2);
	});
});

function stubWorkflowStepsAfterClaim(): void {
	const prototype = ProjectSlackBot.prototype as unknown as Record<string, unknown>;
	for (const step of ['_validateUserAccess', '_saveOrUpdateUserMessage', '_handleStreamAgent']) {
		vi.spyOn(prototype as never, step as never).mockResolvedValue(undefined as never);
	}
	vi.spyOn(prototype as never, '_postSlackCard' as never).mockResolvedValue('1760942786.000300' as never);
}

async function deliver(
	bot: ProjectSlackBot,
	eventType: 'message' | 'app_mention',
	options: { ts?: string } = {},
): Promise<void> {
	const adapter = bot['_bot'].getAdapter('slack') as unknown as { _client: { auth: { test: unknown } } };
	adapter._client.auth.test = slackHarness.authTest;

	const body = JSON.stringify({
		type: 'event_callback',
		team_id: 'T_TEAM',
		event_id: `Ev_${eventType}_${options.ts ?? MESSAGE_TS}`,
		event: {
			type: eventType,
			user: 'U_USER',
			text: `<@${BOT_USER_ID}> how much goa we had yesterday`,
			ts: options.ts ?? MESSAGE_TS,
			channel: 'C_CHANNEL',
			channel_type: 'channel',
			team: 'T_TEAM',
		},
	});
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;

	const tasks: Promise<unknown>[] = [];
	const response = await bot.webhooks.slack(
		new Request('http://localhost/api/webhooks/slack', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-slack-request-timestamp': timestamp,
				'x-slack-signature': signature,
			},
			body,
		}),
		{
			waitUntil: (task: Promise<unknown>) => {
				tasks.push(task);
			},
		},
	);
	expect(response.status).toBe(200);
	await Promise.all(tasks);
	await new Promise((resolve) => setTimeout(resolve, 50));
}
