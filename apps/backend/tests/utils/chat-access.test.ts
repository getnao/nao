import '../../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { replaceAutomationShares } from '../../src/queries/automation-share.queries';
import { canUserViewChatContent } from '../../src/utils/chat-access';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

vi.mock('../../src/queries/locked-user-groups', () => ({
	listLockedUserGroupIds: async () => [],
	listLockedUserGroupIdsOfMember: async () => [],
}));

const PROJECT_ID = 'chat-access-project';
const OWNER_ID = 'chat-access-owner';
const SHARED_ID = 'chat-access-shared';
const OUTSIDER_ID = 'chat-access-outsider';
const ADMIN_ID = 'chat-access-admin';
const FORMER_MEMBER_ID = 'chat-access-former-member';
const SHARED_AUTOMATION_ID = 'chat-access-shared-automation';
const PRIVATE_AUTOMATION_ID = 'chat-access-private-automation';

const CHATS = {
	ownerChat: 'chat-access-owner-chat',
	sharedRun: 'chat-access-shared-run',
	privateRun: 'chat-access-private-run',
	sharedEditor: 'chat-access-shared-editor',
};

describe('canUserViewChatContent', () => {
	beforeAll(async () => {
		await db.insert(s.user).values(
			[OWNER_ID, SHARED_ID, OUTSIDER_ID, ADMIN_ID, FORMER_MEMBER_ID].map((id) => ({
				id,
				name: id,
				email: `${id}@example.com`,
			})),
		);
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Project', type: 'local', path: '/tmp/chat-access' });
		await db.insert(s.projectMember).values([
			{ projectId: PROJECT_ID, userId: OWNER_ID, role: 'user' },
			{ projectId: PROJECT_ID, userId: SHARED_ID, role: 'user' },
			{ projectId: PROJECT_ID, userId: OUTSIDER_ID, role: 'user' },
			{ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'admin' },
		]);
		await db.insert(s.automation).values(
			[SHARED_AUTOMATION_ID, PRIVATE_AUTOMATION_ID].map((id) => ({
				id,
				projectId: PROJECT_ID,
				userId: OWNER_ID,
				title: id,
				prompt: 'Run',
			})),
		);
		await db.insert(s.chat).values([
			{ id: CHATS.ownerChat, userId: OWNER_ID, projectId: PROJECT_ID },
			{ id: CHATS.sharedRun, userId: OWNER_ID, projectId: PROJECT_ID },
			{ id: CHATS.privateRun, userId: OWNER_ID, projectId: PROJECT_ID },
			{
				id: CHATS.sharedEditor,
				userId: OWNER_ID,
				projectId: PROJECT_ID,
				forkMetadata: { type: 'automation_edit', id: SHARED_AUTOMATION_ID, title: 'Edit', authorName: '' },
			},
		]);
		await db.insert(s.automationRun).values([
			{ automationId: SHARED_AUTOMATION_ID, chatId: CHATS.sharedRun, status: 'completed' },
			{ automationId: PRIVATE_AUTOMATION_ID, chatId: CHATS.privateRun, status: 'completed' },
		]);
	});

	beforeEach(async () => {
		await replaceAutomationShares(SHARED_AUTOMATION_ID, [{ userId: SHARED_ID, groupId: null, role: 'viewer' }]);
	});

	afterAll(async () => {
		await db.delete(s.project).execute();
		await db.delete(s.user).execute();
	});

	it.each([
		{ reader: 'the owner', userId: OWNER_ID, chat: 'ownerChat', canView: true },
		{ reader: 'a shared user', userId: SHARED_ID, chat: 'ownerChat', canView: false },
		{ reader: 'a shared user', userId: SHARED_ID, chat: 'sharedRun', canView: true },
		{ reader: 'a shared user', userId: SHARED_ID, chat: 'privateRun', canView: false },
		{ reader: 'a shared user', userId: SHARED_ID, chat: 'sharedEditor', canView: false },
		{ reader: 'another member', userId: OUTSIDER_ID, chat: 'sharedRun', canView: false },
		{ reader: 'a project admin', userId: ADMIN_ID, chat: 'privateRun', canView: true },
	] as const)('lets $reader view the $chat chat: $canView', async ({ userId, chat, canView }) => {
		await expect(canUserViewChatContent(CHATS[chat], PROJECT_ID, userId)).resolves.toBe(canView);
	});

	it.each([
		{ share: 'the whole project', grant: { userId: null, groupId: null, role: 'viewer' } },
		{ share: 'them personally', grant: { userId: FORMER_MEMBER_ID, groupId: null, role: 'viewer' } },
	] as const)('hides run chats from users outside the project, even when shared with $share', async ({ grant }) => {
		await replaceAutomationShares(SHARED_AUTOMATION_ID, [grant]);

		await expect(canUserViewChatContent(CHATS.sharedRun, PROJECT_ID, FORMER_MEMBER_ID)).resolves.toBe(false);
	});

	it('lets project members use a project-wide share', async () => {
		await replaceAutomationShares(SHARED_AUTOMATION_ID, [{ userId: null, groupId: null, role: 'viewer' }]);

		await expect(canUserViewChatContent(CHATS.sharedRun, PROJECT_ID, OUTSIDER_ID)).resolves.toBe(true);
	});

	it('stops showing the run chats once the automation is unshared', async () => {
		await replaceAutomationShares(SHARED_AUTOMATION_ID, []);

		await expect(canUserViewChatContent(CHATS.sharedRun, PROJECT_ID, SHARED_ID)).resolves.toBe(false);
	});
});
