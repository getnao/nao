import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getLatestContextEditChatId, listGroupedChats } from '../../src/queries/chat.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'context-hub-project';
const OTHER_PROJECT_ID = 'context-hub-other-project';
const USER_ID = 'context-hub-user';
const CONTEXT_EDIT = { type: 'context_edit' as const, id: PROJECT_ID, title: 'Context Hub', authorName: '' };

describe('Context Hub chats', () => {
	beforeAll(seed);

	afterAll(() => {
		db.$client.close();
	});

	it.each([
		{ projectId: PROJECT_ID, expected: 'latest-context-chat' },
		{ projectId: 'project-without-chat', expected: null },
	])('resumes the latest Context Hub chat of the project $projectId', async ({ projectId, expected }) => {
		await expect(getLatestContextEditChatId(USER_ID, projectId)).resolves.toBe(expected);
	});

	it('keeps Context Hub chats out of the chat history', async () => {
		const history = await listGroupedChats(USER_ID, 'ownership', []);
		const historyIds = history.groups.flatMap((group) => group.chats.map((chat) => chat.id));

		expect(historyIds).toContain('regular-chat');
		expect(historyIds).not.toContain('latest-context-chat');
	});
});

async function seed() {
	await db.insert(s.user).values({ id: USER_ID, name: 'User', email: 'context-hub-user@example.com' });
	await db.insert(s.project).values([
		{ id: PROJECT_ID, name: 'Context Hub', type: 'local', path: '/tmp/context-hub' },
		{ id: OTHER_PROJECT_ID, name: 'Other', type: 'local', path: '/tmp/context-hub-other' },
	]);
	await db.insert(s.projectMember).values([
		{ projectId: PROJECT_ID, userId: USER_ID, role: 'context_admin' },
		{ projectId: OTHER_PROJECT_ID, userId: USER_ID, role: 'context_admin' },
	]);
	await db.insert(s.chat).values([
		{ id: 'regular-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'Revenue' },
		{
			id: 'older-context-chat',
			userId: USER_ID,
			projectId: PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: CONTEXT_EDIT,
			updatedAt: new Date('2026-01-01'),
		},
		{
			id: 'latest-context-chat',
			userId: USER_ID,
			projectId: PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: CONTEXT_EDIT,
			updatedAt: new Date('2026-02-01'),
		},
		{
			id: 'other-project-context-chat',
			userId: USER_ID,
			projectId: OTHER_PROJECT_ID,
			title: 'Context Hub',
			forkMetadata: { ...CONTEXT_EDIT, id: OTHER_PROJECT_ID },
			updatedAt: new Date('2026-03-01'),
		},
	]);
	await db.insert(s.chatMessage).values([
		{ id: 'regular-chat-message', chatId: 'regular-chat', role: 'user', source: 'web' },
		{ id: 'latest-context-chat-message', chatId: 'latest-context-chat', role: 'user', source: 'web' },
	]);
}
