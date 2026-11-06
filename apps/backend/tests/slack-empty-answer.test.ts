import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../src/services/slack';
import type { ConversationContext } from '../src/types/messaging-provider';

const slackHarness = vi.hoisted(() => ({
	chatDelete: vi.fn(),
	chatPostMessage: vi.fn(),
	chatUpdate: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
	WebClient: class {
		chat = {
			delete: slackHarness.chatDelete,
			postMessage: slackHarness.chatPostMessage,
			update: slackHarness.chatUpdate,
		};
	},
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const ANSWERING_CARD_TS = '1700000000.000200';

const baseConfig: SlackConfig = {
	projectId: 'project-1',
	botToken: 'xoxb-test',
	signingSecret: 'secret',
	redirectUrl: 'https://nao.example.com/',
	autoCreateUsersEnabled: false,
	autoCreateUsersDomains: [],
	transportMode: 'webhook',
	appToken: '',
	replyMode: 'thread',
	dmScopeMissing: false,
};

describe('ProjectSlackBot empty answers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		slackHarness.chatDelete.mockResolvedValue({ ok: true });
		slackHarness.chatPostMessage.mockResolvedValue({ ok: true, ts: '1700000000.000300' });
		slackHarness.chatUpdate.mockResolvedValue({ ok: true });
	});

	it('deletes the answering card instead of posting "No response"', async () => {
		const bot = new ProjectSlackBot(baseConfig);
		const ctx = createContextWithAnsweringCard(bot);

		await bot['_sendFinalText'](ctx, { agent: null, stopRequested: false });

		expect(slackHarness.chatDelete).toHaveBeenCalledWith({ channel: 'C123', ts: ANSWERING_CARD_TS });
		expect(slackHarness.chatUpdate).not.toHaveBeenCalled();
		expect(bot['_getSlackStreamMessageTs'](ctx)).toBeNull();
	});

	it('still tells the user when they stopped the generation', async () => {
		const bot = new ProjectSlackBot(baseConfig);
		const ctx = createContextWithAnsweringCard(bot);

		await bot['_sendFinalText'](ctx, { agent: null, stopRequested: true });

		expect(slackHarness.chatDelete).not.toHaveBeenCalled();
		expect(JSON.stringify(slackHarness.chatUpdate.mock.calls[0][0].blocks)).toContain('Generation stopped');
	});

	it('skips the completion card after an empty answer', async () => {
		const bot = new ProjectSlackBot(baseConfig);
		const ctx = createContextWithAnsweringCard(bot);
		vi.spyOn(bot as never, '_createAgentStream').mockResolvedValue({
			agent: { stop: vi.fn() },
			stream: new ReadableStream({ start: (controller) => controller.close() }),
		} as never);

		await bot['_handleStreamAgent']({} as never, ctx, { agent: null, stopRequested: false });

		expect(slackHarness.chatDelete).toHaveBeenCalledTimes(1);
		expect(slackHarness.chatPostMessage).not.toHaveBeenCalled();
	});
});

function createContextWithAnsweringCard(bot: ProjectSlackBot): ConversationContext {
	const ctx: ConversationContext = {
		thread: { id: 'slack:C123:1700000000.000100' } as ConversationContext['thread'],
		userMessage: {} as ConversationContext['userMessage'],
		user: { id: 'user-1' } as ConversationContext['user'],
		chatId: 'chat-1',
		convMessage: null,
		blocks: [],
		textBlockIndex: -1,
		textBlockCount: 0,
		isNewChat: false,
		modelId: undefined,
		timezone: undefined,
	};
	bot['_getSlackStreamState'](ctx).messageTs = ANSWERING_CARD_TS;
	return ctx;
}
