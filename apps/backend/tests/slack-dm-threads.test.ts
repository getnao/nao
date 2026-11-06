import { describe, expect, it, vi } from 'vitest';

import type { SlackConfig } from '../src/queries/project-slack-config.queries';
import { ProjectSlackBot } from '../src/services/slack';

vi.mock('@slack/web-api', () => ({ WebClient: class {} }));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

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
	dmThreadsEnabled: false,
};

describe('ProjectSlackBot direct message threads', () => {
	const topLevelDirectMessage = { channel_type: 'im', channel: 'D123', ts: '1700000000.000100' };

	it('keeps the whole direct message as one conversation by default', () => {
		const bot = new ProjectSlackBot(baseConfig);

		expect(getSlackAdapter(bot).threadIdForMessageEvent(topLevelDirectMessage)).toBe('slack:D123:');
	});

	it('threads every top-level direct message when enabled', () => {
		const bot = new ProjectSlackBot({ ...baseConfig, dmThreadsEnabled: true });

		expect(getSlackAdapter(bot).threadIdForMessageEvent(topLevelDirectMessage)).toBe(
			'slack:D123:1700000000.000100',
		);
	});
});

function getSlackAdapter(bot: ProjectSlackBot): { threadIdForMessageEvent: (event: object) => string } {
	return bot['_bot'].getAdapter('slack') as never;
}
