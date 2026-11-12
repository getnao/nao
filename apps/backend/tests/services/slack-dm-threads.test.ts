import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../../src/services/slack';
import { createSlackConfig } from '../helpers/slack-config';

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		auth = { test: vi.fn().mockResolvedValue({ ok: true, user_id: 'UBOT', bot_id: 'BBOT', user: 'nao' }) };
		users = { info: vi.fn().mockResolvedValue({ ok: true, user: { id: 'UHUMAN', name: 'ada' } }) };
	},
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const SIGNING_SECRET = 'secret';
const FIRST_MESSAGE_TS = '1700000000.000100';
const SECOND_MESSAGE_TS = '1700000000.000200';
const THREAD_REPLY_TS = '1700000000.000300';

const baseConfig = createSlackConfig({ signingSecret: SIGNING_SECRET });

describe('ProjectSlackBot direct message threads', () => {
	it('keeps the whole direct message as one conversation by default', async () => {
		const { bot, answeredThreadIds } = createBotRecordingAnswers(baseConfig);

		await deliverDirectMessage(bot, { ts: FIRST_MESSAGE_TS, text: 'first question' });
		await deliverDirectMessage(bot, { ts: SECOND_MESSAGE_TS, text: 'second question' });

		expect(answeredThreadIds).toEqual(['slack:D123:', 'slack:D123:']);
	});

	it('starts a thread per top-level direct message and continues it on replies', async () => {
		const { bot, answeredThreadIds } = createBotRecordingAnswers({ ...baseConfig, dmThreadsEnabled: true });

		await deliverDirectMessage(bot, { ts: FIRST_MESSAGE_TS, text: 'first question' });
		await deliverDirectMessage(bot, { ts: THREAD_REPLY_TS, threadTs: FIRST_MESSAGE_TS, text: 'follow-up' });
		await deliverDirectMessage(bot, { ts: SECOND_MESSAGE_TS, text: 'second question' });

		expect(answeredThreadIds).toEqual([
			`slack:D123:${FIRST_MESSAGE_TS}`,
			`slack:D123:${FIRST_MESSAGE_TS}`,
			`slack:D123:${SECOND_MESSAGE_TS}`,
		]);
	});
});

function createBotRecordingAnswers(config: SlackConfig): { bot: ProjectSlackBot; answeredThreadIds: string[] } {
	const bot = new ProjectSlackBot(config);
	const answeredThreadIds: string[] = [];
	vi.spyOn(bot as never, '_isThreadStarter').mockImplementation(
		(async (threadId: string) => !threadId.endsWith(':')) as never,
	);
	vi.spyOn(bot as never, '_handleWorkFlow').mockImplementation((async (thread: { id: string }) => {
		answeredThreadIds.push(thread.id);
	}) as never);
	return { bot, answeredThreadIds };
}

async function deliverDirectMessage(
	bot: ProjectSlackBot,
	message: { ts: string; text: string; threadTs?: string },
): Promise<void> {
	const body = JSON.stringify({
		type: 'event_callback',
		team_id: 'T123',
		event_id: `Ev${message.ts}`,
		event: {
			type: 'message',
			channel_type: 'im',
			channel: 'D123',
			user: 'UHUMAN',
			text: message.text,
			ts: message.ts,
			...(message.threadTs ? { thread_ts: message.threadTs } : {}),
		},
	});
	const pending: Promise<unknown>[] = [];
	const response = await bot.webhooks.slack(createSignedRequest(body), {
		waitUntil: (task: Promise<unknown>) => pending.push(task),
	});
	expect(response.status).toBe(200);
	await Promise.all(pending);
}

function createSignedRequest(body: string): Request {
	const timestamp = Math.floor(Date.now() / 1000).toString();
	const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
	return new Request('https://nao.example.com/api/webhooks/slack/project-1', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-slack-request-timestamp': timestamp,
			'x-slack-signature': signature,
		},
		body,
	});
}
