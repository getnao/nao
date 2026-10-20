import '../src/env';

import { DEFAULT_TOOL_CALL_DENSITY_POLICY, type ProjectSharingPermission, serializeUserGroupConfig } from '@nao/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	assertCanShareToProject,
	assertCanShareWith,
	getShareAudience,
	previewProjectWideShareRevocation,
	revokeUnauthorizedProjectWideShares,
} from '../src/services/project-sharing.service';

const mocks = vi.hoisted(() => ({ ensureStoryPrivate: vi.fn(), teardownStoryDelivery: vi.fn() }));

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
vi.mock('../src/services/license.service', () => ({
	hasFeature: vi.fn(async () => true),
	LICENSE_FEATURES: { userGroups: 'user-groups' },
}));
vi.mock('../src/queries/story-folder.queries', () => ({ ensureStoryPrivate: mocks.ensureStoryPrivate }));
vi.mock('../src/services/story-delivery.service', () => ({ teardownStoryDelivery: mocks.teardownStoryDelivery }));

const PROJECT_ID = 'sharing-project';
const ALL_USERS_ID = 'sharing-all-users';
const CLIENT_A_ID = 'sharing-client-a';
const CLIENT_B_ID = 'sharing-client-b';
const ADMIN_ID = 'sharing-admin';
const ALICE_ID = 'sharing-alice';
const BOB_ID = 'sharing-bob';
const CAROL_ID = 'sharing-carol';
const DAVE_ID = 'sharing-dave';

const MEMBERS = [
	{ userId: ADMIN_ID, role: 'admin' as const },
	{ userId: ALICE_ID, role: 'user' as const },
	{ userId: BOB_ID, role: 'user' as const },
	{ userId: CAROL_ID, role: 'user' as const },
	{ userId: DAVE_ID, role: 'user' as const },
];

describe('project sharing permission', () => {
	beforeAll(async () => {
		await db
			.insert(s.user)
			.values(MEMBERS.map(({ userId }) => ({ id: userId, name: userId, email: `${userId}@x.io` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Sharing', type: 'local', path: '/tmp/sharing' });
		await db.insert(s.projectMember).values(MEMBERS.map((member) => ({ projectId: PROJECT_ID, ...member })));
		await db.insert(s.userGroup).values([
			{ id: ALL_USERS_ID, projectId: PROJECT_ID, name: 'All Users', isDefault: true },
			{ id: CLIENT_A_ID, projectId: PROJECT_ID, name: 'Client A' },
			{ id: CLIENT_B_ID, projectId: PROJECT_ID, name: 'Client B' },
		]);
		await db.insert(s.userGroupMember).values([
			{ groupId: CLIENT_A_ID, userId: ALICE_ID },
			{ groupId: CLIENT_A_ID, userId: BOB_ID },
			{ groupId: CLIENT_B_ID, userId: CAROL_ID },
		]);
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		await db.delete(s.sharedChat);
		await db.delete(s.sharedStory);
		await setProjectSharing(ALL_USERS_ID, 'inherit');
		await setProjectSharing(CLIENT_A_ID, 'inherit');
		await setProjectSharing(CLIENT_B_ID, 'inherit');
	});

	afterAll(() => {
		db.$client.close();
	});

	it('lets everyone share with the entire project by default', async () => {
		for (const { userId } of MEMBERS) {
			expect(await getShareAudience(PROJECT_ID, userId)).toEqual({ canShareToProject: true });
		}
	});

	it('limits members of a blocked group to their groups and those groups members', async () => {
		await setProjectSharing(CLIENT_A_ID, 'blocked');

		expect(await getShareAudience(PROJECT_ID, ALICE_ID)).toEqual({
			canShareToProject: false,
			groupIds: new Set([CLIENT_A_ID]),
			memberIds: new Set([ALICE_ID, BOB_ID]),
		});
		expect(await getShareAudience(PROJECT_ID, CAROL_ID)).toEqual({ canShareToProject: true });
		await expect(assertCanShareToProject(PROJECT_ID, ALICE_ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(
			assertCanShareWith(PROJECT_ID, ALICE_ID, { userIds: [BOB_ID], groupIds: [CLIENT_A_ID] }),
		).resolves.toBeUndefined();
		await expect(assertCanShareWith(PROJECT_ID, ALICE_ID, { userIds: [CAROL_ID] })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(assertCanShareWith(PROJECT_ID, ALICE_ID, { groupIds: [CLIENT_B_ID] })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('applies the All Users default unless a group explicitly allows sharing', async () => {
		await setProjectSharing(ALL_USERS_ID, 'blocked');
		await setProjectSharing(CLIENT_B_ID, 'allowed');

		expect(await getShareAudience(PROJECT_ID, CAROL_ID)).toEqual({ canShareToProject: true });
		expect(await getShareAudience(PROJECT_ID, ALICE_ID)).toMatchObject({ canShareToProject: false });
		expect(await getShareAudience(PROJECT_ID, DAVE_ID)).toEqual({
			canShareToProject: false,
			groupIds: new Set(),
			memberIds: new Set([DAVE_ID]),
		});
	});

	it('always lets admins share with the entire project', async () => {
		await setProjectSharing(ALL_USERS_ID, 'blocked');

		await expect(assertCanShareToProject(PROJECT_ID, ADMIN_ID)).resolves.toBeUndefined();
	});

	it('previews and unshares only project-wide content of members who lost the permission', async () => {
		const aliceProjectChat = await shareChat('alice-project-chat', ALICE_ID, 'project');
		const aliceSpecificChat = await shareChat('alice-specific-chat', ALICE_ID, 'specific');
		const carolProjectChat = await shareChat('carol-project-chat', CAROL_ID, 'project');
		await shareStory('alice-story', ALICE_ID);
		await shareStory('admin-story', ADMIN_ID);

		expect(await previewProjectWideShareRevocation(PROJECT_ID, CLIENT_A_ID, 'blocked')).toEqual({
			chatCount: 1,
			storyCount: 1,
		});
		expect(await listSharedChatIds()).toHaveLength(3);

		await setProjectSharing(CLIENT_A_ID, 'blocked');
		await revokeUnauthorizedProjectWideShares(PROJECT_ID);

		expect(await listSharedChatIds()).toEqual(expect.arrayContaining([aliceSpecificChat, carolProjectChat]));
		expect(await listSharedChatIds()).not.toContain(aliceProjectChat);
		expect(await listSharedStoryIds()).toEqual(['admin-story']);
		expect(mocks.ensureStoryPrivate).toHaveBeenCalledWith('alice-story', {
			storyOwnerId: ALICE_ID,
			projectId: PROJECT_ID,
		});
		expect(mocks.teardownStoryDelivery).toHaveBeenCalledWith('alice-story');
	});
});

async function setProjectSharing(groupId: string, projectSharing: ProjectSharingPermission) {
	await db
		.update(s.userGroup)
		.set({ featureGrants: serializeUserGroupConfig([], DEFAULT_TOOL_CALL_DENSITY_POLICY, projectSharing) })
		.where(eq(s.userGroup.id, groupId));
}

async function shareChat(chatId: string, userId: string, visibility: 'project' | 'specific') {
	await db.insert(s.chat).values({ id: chatId, userId, projectId: PROJECT_ID }).onConflictDoNothing();
	const [share] = await db.insert(s.sharedChat).values({ chatId, visibility }).returning();
	return share.id;
}

async function shareStory(storyId: string, userId: string) {
	await db
		.insert(s.story)
		.values({ id: storyId, projectId: PROJECT_ID, userId, slug: storyId, title: storyId })
		.onConflictDoNothing();
	await db.insert(s.sharedStory).values({ storyId, projectId: PROJECT_ID, userId, visibility: 'project' });
}

async function listSharedChatIds() {
	return (await db.select({ id: s.sharedChat.id }).from(s.sharedChat)).map((row) => row.id);
}

async function listSharedStoryIds() {
	return (await db.select({ storyId: s.sharedStory.storyId }).from(s.sharedStory)).map((row) => row.storyId);
}
