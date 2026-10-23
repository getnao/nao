import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { countStoryViewsForUser } from '../src/queries/analytics-event.queries';
import { createSharedStory } from '../src/queries/shared-story.queries';

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

const PROJECT_ID = 'view-counts-project';
const OWNER_ID = 'view-counts-owner';
const VIEWER_ID = 'view-counts-viewer';
const CHAT_ID = 'view-counts-chat';

const CHAT_STORY_ID = 'chat-story';
const PRIVATE_STORY_ID = 'private-story';
const PROJECT_SHARED_STORY_ID = 'project-shared-story';
const DIRECTLY_SHARED_STORY_ID = 'directly-shared-story';

describe('story view counts', () => {
	beforeAll(async () => {
		await db
			.insert(s.user)
			.values([OWNER_ID, VIEWER_ID].map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Views', type: 'local', path: '/tmp/views' });
		await db
			.insert(s.projectMember)
			.values([OWNER_ID, VIEWER_ID].map((userId) => ({ projectId: PROJECT_ID, userId, role: 'user' as const })));
		await db.insert(s.chat).values({ id: CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID });
		await db.insert(s.story).values([
			{ id: CHAT_STORY_ID, projectId: PROJECT_ID, chatId: CHAT_ID, slug: 'chat', title: 'Chat' },
			...[PRIVATE_STORY_ID, PROJECT_SHARED_STORY_ID, DIRECTLY_SHARED_STORY_ID].map((id) => ({
				id,
				projectId: PROJECT_ID,
				userId: OWNER_ID,
				slug: id,
				title: id,
			})),
		]);

		await createSharedStory({
			storyId: PROJECT_SHARED_STORY_ID,
			projectId: PROJECT_ID,
			userId: OWNER_ID,
			visibility: 'project',
		});
		await createSharedStory(
			{ storyId: DIRECTLY_SHARED_STORY_ID, projectId: PROJECT_ID, userId: OWNER_ID, visibility: 'specific' },
			{ userIds: [VIEWER_ID], groupIds: [] },
		);

		await logViews(CHAT_STORY_ID, 3);
		await logViews(PRIVATE_STORY_ID, 2);
		await logViews(PROJECT_SHARED_STORY_ID, 5);
		await logViews(DIRECTLY_SHARED_STORY_ID, 1);
		await db.insert(s.analyticsEvent).values({
			projectId: PROJECT_ID,
			type: 'download',
			assetType: 'story',
			storyId: PROJECT_SHARED_STORY_ID,
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	it('counts page views of every story the owner can see', async () => {
		expect(await countStoryViewsForUser(PROJECT_ID, OWNER_ID)).toEqual({
			[CHAT_STORY_ID]: 3,
			[PRIVATE_STORY_ID]: 2,
			[PROJECT_SHARED_STORY_ID]: 5,
			[DIRECTLY_SHARED_STORY_ID]: 1,
		});
	});

	it('hides view counts of stories that are not shared with the user', async () => {
		expect(await countStoryViewsForUser(PROJECT_ID, VIEWER_ID)).toEqual({
			[PROJECT_SHARED_STORY_ID]: 5,
			[DIRECTLY_SHARED_STORY_ID]: 1,
		});
	});
});

async function logViews(storyId: string, views: number) {
	await db.insert(s.analyticsEvent).values(
		Array.from({ length: views }, () => ({
			projectId: PROJECT_ID,
			type: 'page_view' as const,
			assetType: 'story' as const,
			storyId,
		})),
	);
}
