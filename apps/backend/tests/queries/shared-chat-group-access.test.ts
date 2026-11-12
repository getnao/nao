import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	canUserAccessSharedChat,
	getShareAllowedGroupIds,
	getShareAllowedUserIds,
	getSharedChatRecipientUserIds,
	replaceSharedChatAccess,
} from '../../src/queries/shared-chat.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'group-share-project';
const OWNER_ID = 'group-share-owner';
const DIRECT_RECIPIENT_ID = 'group-share-direct';
const GROUP_MEMBER_ID = 'group-share-member';
const OUTSIDER_ID = 'group-share-outsider';
const FORMER_MEMBER_ID = 'group-share-former-member';
const GROUP_ID = 'group-share-group';
const SHARE_ID = 'group-share-share';

beforeAll(seed);

afterAll(() => {
	db.$client.close();
});

describe('canUserAccessSharedChat', () => {
	it('lets in the people the chat is shared with directly', async () => {
		expect(await canUserAccessSharedChat(SHARE_ID, DIRECT_RECIPIENT_ID)).toBe(true);
	});

	it('lets in the members of a group the chat is shared with', async () => {
		expect(await canUserAccessSharedChat(SHARE_ID, GROUP_MEMBER_ID)).toBe(true);
	});

	it('keeps out everyone else', async () => {
		expect(await canUserAccessSharedChat(SHARE_ID, OUTSIDER_ID)).toBe(false);
	});

	it('keeps out a group member who left the project, and does not count them as a recipient', async () => {
		expect(await canUserAccessSharedChat(SHARE_ID, FORMER_MEMBER_ID)).toBe(false);
		expect((await getSharedChatRecipientUserIds(SHARE_ID)).sort()).toEqual(
			[DIRECT_RECIPIENT_ID, GROUP_MEMBER_ID].sort(),
		);
	});
});

describe('replaceSharedChatAccess', () => {
	it('names exactly the people and groups saved, and their visibility', async () => {
		await replaceSharedChatAccess(SHARE_ID, {
			visibility: 'project',
			userIds: [GROUP_MEMBER_ID],
			groupIds: [],
		});

		expect(await getShareAllowedUserIds(SHARE_ID)).toEqual([GROUP_MEMBER_ID]);
		expect(await getShareAllowedGroupIds(SHARE_ID)).toEqual([]);
		const [share] = await db.select({ visibility: s.sharedChat.visibility }).from(s.sharedChat);
		expect(share.visibility).toBe('project');
	});
});

async function seed() {
	await db.insert(s.user).values(
		[OWNER_ID, DIRECT_RECIPIENT_ID, GROUP_MEMBER_ID, OUTSIDER_ID, FORMER_MEMBER_ID].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
		})),
	);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Group shares', type: 'local', path: '/tmp/group' });
	await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Analysts' });
	await db.insert(s.projectMember).values(
		[OWNER_ID, DIRECT_RECIPIENT_ID, GROUP_MEMBER_ID].map((userId) => ({
			projectId: PROJECT_ID,
			userId,
			role: 'user',
		})),
	);
	await db.insert(s.userGroupMember).values([
		{ groupId: GROUP_ID, userId: GROUP_MEMBER_ID },
		{ groupId: GROUP_ID, userId: FORMER_MEMBER_ID },
	]);
	await db.insert(s.chat).values({ id: 'group-share-chat', projectId: PROJECT_ID, userId: OWNER_ID, title: 'Chat' });
	await db.insert(s.sharedChat).values({ id: SHARE_ID, chatId: 'group-share-chat', visibility: 'specific' });
	await db.insert(s.sharedChatAccess).values({ sharedChatId: SHARE_ID, userId: DIRECT_RECIPIENT_ID });
	await db.insert(s.sharedChatGroupAccess).values({ sharedChatId: SHARE_ID, groupId: GROUP_ID });
}
