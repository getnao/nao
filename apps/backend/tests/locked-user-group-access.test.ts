import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { canUserAccessSharedChat, getSharedChatRecipientUserIds } from '../src/queries/shared-chat.queries';
import {
	canUserAccessSharedStory,
	getSharedStoryRecipientUserIds,
	getStoryShareRole,
	listUserSharedStories,
} from '../src/queries/shared-story.queries';
import { canUserAccessStory } from '../src/queries/story.queries';
import { listReferenceableStories } from '../src/queries/story-reference.queries';

const mocks = vi.hoisted(() => ({ hasFeature: vi.fn() }));

vi.mock('../src/services/license.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/license.service')>()),
	hasFeature: mocks.hasFeature,
}));

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

const PROJECT_ID = 'locked-group-project';
const OWNER_ID = 'locked-group-owner';
const MEMBER_ID = 'locked-group-member';
const STORY_ID = 'locked-group-story';
const SHARED_STORY_ID = 'locked-group-shared-story';
const SHARED_CHAT_ID = 'locked-group-shared-chat';
const OLDER_GROUP_IDS = ['locked-group-1', 'locked-group-2', 'locked-group-3'];
const NEWEST_GROUP_ID = 'locked-group-4';

beforeAll(seed);

beforeEach(() => {
	mocks.hasFeature.mockResolvedValue(false);
});

afterAll(() => {
	db.$client.close();
});

describe('a user group the free plan locks', () => {
	it('stops granting the story to its members, as viewers or editors', async () => {
		expect(await canUserAccessSharedStory(SHARED_STORY_ID, MEMBER_ID)).toBe(false);
		expect(await canUserAccessStory(STORY_ID, MEMBER_ID)).toBe(false);
		expect(await getStoryShareRole(STORY_ID, MEMBER_ID)).toBeNull();
		expect(await listUserSharedStories(PROJECT_ID, MEMBER_ID)).toHaveLength(0);
		expect(await listReferenceableStories(MEMBER_ID, PROJECT_ID)).toHaveLength(0);
	});

	it('stops granting the chat to its members', async () => {
		expect(await canUserAccessSharedChat(SHARED_CHAT_ID, MEMBER_ID)).toBe(false);
	});

	it('no longer counts its members as recipients', async () => {
		expect(await getSharedStoryRecipientUserIds(SHARED_STORY_ID)).toEqual([]);
		expect(await getSharedChatRecipientUserIds(SHARED_CHAT_ID)).toEqual([]);
	});

	it('grants everything again, as saved, once the plan reactivates it', async () => {
		mocks.hasFeature.mockResolvedValue(true);

		expect(await canUserAccessSharedStory(SHARED_STORY_ID, MEMBER_ID)).toBe(true);
		expect(await getStoryShareRole(STORY_ID, MEMBER_ID)).toBe('editor');
		expect(await canUserAccessSharedChat(SHARED_CHAT_ID, MEMBER_ID)).toBe(true);
		expect(await getSharedStoryRecipientUserIds(SHARED_STORY_ID)).toEqual([MEMBER_ID]);
	});
});

async function seed() {
	await db.insert(s.user).values([OWNER_ID, MEMBER_ID].map((id) => ({ id, name: id, email: `${id}@example.com` })));
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Locked groups', type: 'local', path: '/tmp/locked' });
	await db
		.insert(s.projectMember)
		.values([OWNER_ID, MEMBER_ID].map((userId) => ({ projectId: PROJECT_ID, userId, role: 'user' as const })));
	await db.insert(s.userGroup).values(
		[...OLDER_GROUP_IDS, NEWEST_GROUP_ID].map((id, index) => ({
			id,
			projectId: PROJECT_ID,
			name: id,
			createdAt: new Date(2026, 0, index + 1),
		})),
	);
	await db.insert(s.userGroupMember).values({ groupId: NEWEST_GROUP_ID, userId: MEMBER_ID });

	await db
		.insert(s.story)
		.values({ id: STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, slug: 'revenue', title: 'Revenue' });
	await db
		.insert(s.storyVersion)
		.values({ storyId: STORY_ID, version: 1, code: '# Revenue', action: 'create', source: 'user' });
	await db.insert(s.sharedStory).values({
		id: SHARED_STORY_ID,
		storyId: STORY_ID,
		projectId: PROJECT_ID,
		userId: OWNER_ID,
		visibility: 'specific',
	});
	await db
		.insert(s.sharedStoryGroupAccess)
		.values({ sharedStoryId: SHARED_STORY_ID, groupId: NEWEST_GROUP_ID, role: 'editor' });

	await db.insert(s.chat).values({ id: 'locked-group-chat', projectId: PROJECT_ID, userId: OWNER_ID, title: 'Chat' });
	await db.insert(s.sharedChat).values({ id: SHARED_CHAT_ID, chatId: 'locked-group-chat', visibility: 'specific' });
	await db.insert(s.sharedChatGroupAccess).values({ sharedChatId: SHARED_CHAT_ID, groupId: NEWEST_GROUP_ID });
}
