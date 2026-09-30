import '../src/env';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	canUserAccessSharedStory,
	createSharedStory,
	getSharedStoryRecipientUserIds,
	getStoryShareAccess,
	listUserSharedStories,
	updateSharedStoryRecipients,
} from '../src/queries/shared-story.queries';
import { canUserAccessStory, getStorySharingInfo } from '../src/queries/story.queries';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

const PROJECT_ID = 'group-share-project';
const STORY_ID = 'group-share-story';
const OWNER_ID = 'group-share-owner';
const GROUP_MEMBER_ID = 'group-share-member';
const DIRECT_USER_ID = 'group-share-direct';
const OUTSIDER_ID = 'group-share-outsider';
const GROUP_ID = 'group-share-analysts';

const USER_IDS = [OWNER_ID, GROUP_MEMBER_ID, DIRECT_USER_ID, OUTSIDER_ID];

describe('sharing a story with user groups', () => {
	beforeAll(async () => {
		await db.insert(s.user).values(USER_IDS.map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Group Share', type: 'local', path: '/tmp/gs' });
		await db
			.insert(s.projectMember)
			.values(USER_IDS.map((userId) => ({ projectId: PROJECT_ID, userId, role: 'user' as const })));
		await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Analysts' });
		await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: GROUP_MEMBER_ID });
		await db
			.insert(s.story)
			.values({ id: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, slug: 'revenue', title: 'Revenue' });
		await db
			.insert(s.storyVersion)
			.values({ storyId: STORY_ID, version: 1, code: '# Revenue', action: 'create', source: 'user' });
	});

	beforeEach(async () => {
		await db.delete(s.sharedStory);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('grants access to group members and direct users only', async () => {
		const shared = await shareWithGroupAndDirectUser();

		expect(await canUserAccessSharedStory(shared.id, GROUP_MEMBER_ID)).toBe(true);
		expect(await canUserAccessSharedStory(shared.id, DIRECT_USER_ID)).toBe(true);
		expect(await canUserAccessSharedStory(shared.id, OUTSIDER_ID)).toBe(false);
		expect(await canUserAccessStory(STORY_ID, GROUP_MEMBER_ID)).toBe(true);
		expect(await canUserAccessStory(STORY_ID, OUTSIDER_ID)).toBe(false);
	});

	it('resolves recipients from direct grants and current group membership', async () => {
		const shared = await shareWithGroupAndDirectUser();

		expect((await getSharedStoryRecipientUserIds(shared.id)).sort()).toEqual([DIRECT_USER_ID, GROUP_MEMBER_ID]);
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toMatchObject({
			shareId: shared.id,
			visibility: 'specific',
			allowedUserIds: [DIRECT_USER_ID],
			allowedGroupIds: [GROUP_ID],
		});
	});

	it('follows group membership changes after the story is shared', async () => {
		const shared = await shareWithGroupAndDirectUser();

		await db.insert(s.userGroupMember).values({ groupId: GROUP_ID, userId: OUTSIDER_ID });
		expect(await canUserAccessSharedStory(shared.id, OUTSIDER_ID)).toBe(true);
		expect(await getSharedStoryRecipientUserIds(shared.id)).toContain(OUTSIDER_ID);

		await db
			.delete(s.userGroupMember)
			.where(and(eq(s.userGroupMember.groupId, GROUP_ID), eq(s.userGroupMember.userId, OUTSIDER_ID)));
		expect(await canUserAccessSharedStory(shared.id, OUTSIDER_ID)).toBe(false);
		expect(await getSharedStoryRecipientUserIds(shared.id)).not.toContain(OUTSIDER_ID);
	});

	it('lists group shares for members with user and group counts', async () => {
		await shareWithGroupAndDirectUser();

		const memberStories = await listUserSharedStories([PROJECT_ID], GROUP_MEMBER_ID, PROJECT_ID);
		const outsiderStories = await listUserSharedStories([PROJECT_ID], OUTSIDER_ID, PROJECT_ID);
		const sharingInfo = await getStorySharingInfo([STORY_ID]);

		expect(memberStories).toHaveLength(1);
		expect(memberStories[0]).toMatchObject({ sharedWithCount: 1, sharedWithGroupCount: 1 });
		expect(outsiderStories).toHaveLength(0);
		expect(sharingInfo.get(STORY_ID)).toMatchObject({ sharedWithCount: 1, sharedWithGroupCount: 1 });
	});

	it('replaces group grants when access is updated or the share becomes project-wide', async () => {
		const shared = await shareWithGroupAndDirectUser();

		await updateSharedStoryRecipients(shared.id, { userIds: [DIRECT_USER_ID], groupIds: [] });
		expect(await canUserAccessSharedStory(shared.id, GROUP_MEMBER_ID)).toBe(false);

		await updateSharedStoryRecipients(shared.id, { userIds: [], groupIds: [GROUP_ID] });
		await createSharedStory({ storyId: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, visibility: 'project' });
		expect(await getStoryShareAccess(STORY_ID, PROJECT_ID)).toMatchObject({ allowedGroupIds: [] });
		expect(await getSharedStoryRecipientUserIds(shared.id)).toEqual([]);
	});
});

function shareWithGroupAndDirectUser() {
	return createSharedStory(
		{ storyId: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, visibility: 'specific' },
		{ userIds: [DIRECT_USER_ID], groupIds: [GROUP_ID] },
	);
}
