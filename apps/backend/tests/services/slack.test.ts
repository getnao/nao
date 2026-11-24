import { describe, expect, it, vi } from 'vitest';

import { ProjectSlackBot } from '../../src/services/slack';
import { createSlackConfig } from '../helpers/slack-config';

vi.mock('@slack/web-api', () => ({ WebClient: class {} }));
vi.mock('../../src/db/db', () => ({ db: {} }));

const BOT_USER_ID = 'U_NAO';
const THREAD = [
	{ ts: '1', user: BOT_USER_ID, bot_id: 'B_NAO', text: 'Weekly revenue report, details in thread' },
	{ ts: '2', user: BOT_USER_ID, bot_id: 'B_NAO', text: 'Revenue is down 12%' },
	{ ts: '3', user: 'U_ALICE', text: 'Why is EMEA down?' },
	{ ts: '4', bot_id: 'B_OTHER', bot_profile: { name: 'Alerts' }, text: 'EMEA pipeline delayed' },
	{ ts: '5', user: 'U_BOB', text: '@nao break it down by country' },
];

describe('ProjectSlackBot unseen thread messages', () => {
	it('gives the whole thread, bot messages included, to a chat not yet linked to it', () => {
		expect(extractUnseen(false)).toEqual(['1', '2', '3', '4']);
	});

	it('gives what came after nao last posted, other bots included, to a linked chat', () => {
		expect(extractUnseen(true)).toEqual(['3', '4']);
	});
});

function extractUnseen(isChatLinked: boolean): string[] {
	const bot = new ProjectSlackBot(createSlackConfig());
	vi.spyOn(bot['_bot'], 'getAdapter').mockReturnValue({ botUserId: BOT_USER_ID } as never);
	return bot['_extractUnseenMessages'](THREAD, '5', isChatLinked).map((message) => message.ts ?? '');
}
