import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { listGroupedChats, searchUserChats } from '../../src/queries/chat.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'visibility-project';
const USER_ID = 'visibility-user';
const TEAMMATE_ID = 'visibility-teammate';
const OWN_CHAT_ID = 'own-revenue-chat';
const OWN_TEST_CHAT_ID = 'own-revenue-test-chat';
const SHARED_CHAT_ID = 'shared-revenue-chat';
const SHARED_TEST_CHAT_ID = 'shared-revenue-test-chat';

describe('test chats visibility', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it('keeps test chats out of the chat history, including chats shared with the user', async () => {
		const history = await listGroupedChats(USER_ID, 'ownership', []);
		const historyIds = history.groups.flatMap((group) => group.chats.map((chat) => chat.id));

		expect(historyIds).toEqual(expect.arrayContaining([OWN_CHAT_ID, SHARED_CHAT_ID]));
		expect(historyIds).not.toContain(OWN_TEST_CHAT_ID);
		expect(historyIds).not.toContain(SHARED_TEST_CHAT_ID);
	});

	it('keeps test chats out of the chat search', async () => {
		const results = await searchUserChats(USER_ID, 'Revenue');

		expect(results.map((chat) => chat.id)).toEqual([OWN_CHAT_ID]);
	});
});

async function seed() {
	await db.insert(s.user).values([
		{ id: USER_ID, name: 'User', email: 'visibility-user@example.com' },
		{ id: TEAMMATE_ID, name: 'Teammate', email: 'visibility-teammate@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Visibility', type: 'local', path: '/tmp/visibility' });
	await db.insert(s.projectMember).values([
		{ projectId: PROJECT_ID, userId: USER_ID, role: 'admin' },
		{ projectId: PROJECT_ID, userId: TEAMMATE_ID, role: 'user' },
	]);
	await db.insert(s.chat).values([
		{ id: OWN_CHAT_ID, userId: USER_ID, projectId: PROJECT_ID, title: 'Revenue analysis' },
		{ id: OWN_TEST_CHAT_ID, userId: USER_ID, projectId: PROJECT_ID, title: 'Test: Revenue' },
		{ id: SHARED_CHAT_ID, userId: TEAMMATE_ID, projectId: PROJECT_ID, title: 'Revenue by region' },
		{ id: SHARED_TEST_CHAT_ID, userId: TEAMMATE_ID, projectId: PROJECT_ID, title: 'Test: Revenue by region' },
	]);
	await db.insert(s.chatMessage).values([
		{ id: `${OWN_CHAT_ID}-message`, chatId: OWN_CHAT_ID, role: 'user', source: 'web' },
		{ id: `${OWN_TEST_CHAT_ID}-message`, chatId: OWN_TEST_CHAT_ID, role: 'user', source: 'test' },
		{ id: `${SHARED_CHAT_ID}-message`, chatId: SHARED_CHAT_ID, role: 'user', source: 'web' },
		{ id: `${SHARED_TEST_CHAT_ID}-message`, chatId: SHARED_TEST_CHAT_ID, role: 'user', source: 'test' },
	]);
	await db.insert(s.sharedChat).values([{ chatId: SHARED_CHAT_ID }, { chatId: SHARED_TEST_CHAT_ID }]);
}
