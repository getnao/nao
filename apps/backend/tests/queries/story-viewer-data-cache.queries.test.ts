import '../../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import {
	deleteStoryViewerDataCache,
	getProjectViewerCacheRevision,
	getStoryViewerDataCache,
	invalidateProjectViewerCaches,
	upsertStoryViewerDataCache,
} from '../../src/queries/story-viewer-data-cache.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'viewer-cache-project';
const OTHER_PROJECT_ID = 'viewer-cache-other-project';
const OWNER_ID = 'viewer-cache-owner';
const VIEWER_ID = 'viewer-cache-viewer';
const STORY = { storyId: 'viewer-cache-story', storyVersionId: 'viewer-cache-story-version' };
const CHAT_STORY = { storyId: 'viewer-cache-chat-story', storyVersionId: 'viewer-cache-chat-story-version' };
const OTHER_PROJECT_STORY = { storyId: 'viewer-cache-foreign-story', storyVersionId: 'viewer-cache-foreign-version' };
const CHAT_ID = 'viewer-cache-chat';

describe('story viewer data cache', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([OWNER_ID, VIEWER_ID].map((id) => ({ id, name: id, email: `${id}@example.com` })));
		await db.insert(s.project).values([
			{ id: PROJECT_ID, name: 'Viewer cache', type: 'local', path: '/tmp/viewer-cache' },
			{ id: OTHER_PROJECT_ID, name: 'Other', type: 'local', path: '/tmp/viewer-cache-other' },
		]);
		await db.insert(s.chat).values({ id: CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Chat' });
		await db.insert(s.story).values([
			{ id: STORY.storyId, projectId: PROJECT_ID, userId: OWNER_ID, slug: 'revenue', title: 'Revenue' },
			{ id: CHAT_STORY.storyId, chatId: CHAT_ID, slug: 'orders', title: 'Orders' },
			{
				id: OTHER_PROJECT_STORY.storyId,
				projectId: OTHER_PROJECT_ID,
				userId: OWNER_ID,
				slug: 'foreign',
				title: 'Foreign',
			},
		]);
		await db.insert(s.storyVersion).values(
			[STORY, CHAT_STORY, OTHER_PROJECT_STORY].map(({ storyId, storyVersionId }) => ({
				id: storyVersionId,
				storyId,
				version: 1,
				code: '# Story',
				action: 'create' as const,
				source: 'user' as const,
			})),
		);
	});

	beforeEach(async () => {
		await db.delete(s.storyViewerDataCache);
		await db.update(s.project).set({ viewerCacheRevision: 0 }).where(eq(s.project.id, PROJECT_ID));
	});

	afterAll(() => {
		db.$client.close();
	});

	it('returns a row only for the access it was written under', async () => {
		await upsertStoryViewerDataCache(cacheEntry(STORY, 'access-a'));

		await expect(getStoryViewerDataCache(cacheKey(STORY, 'access-a'))).resolves.toMatchObject({
			queryData: { q_revenue: { columns: ['revenue'], data: [{ revenue: 1 }] } },
			code: '# Viewer story',
			analysisResults: { summary: 'Viewer summary' },
		});
		await expect(getStoryViewerDataCache(cacheKey(STORY, 'access-b'))).resolves.toBeNull();
		await expect(getStoryViewerDataCache({ ...cacheKey(STORY, 'access-a'), userId: OWNER_ID })).resolves.toBeNull();
	});

	it('keeps one row per viewer and version, replaced by the latest write', async () => {
		await upsertStoryViewerDataCache(cacheEntry(STORY, 'access-a'));
		await upsertStoryViewerDataCache({ ...cacheEntry(STORY, 'access-b'), code: '# Rewritten' });

		await expect(db.select().from(s.storyViewerDataCache)).resolves.toHaveLength(1);
		await expect(getStoryViewerDataCache(cacheKey(STORY, 'access-a'))).resolves.toBeNull();
		await expect(getStoryViewerDataCache(cacheKey(STORY, 'access-b'))).resolves.toMatchObject({
			code: '# Rewritten',
		});
	});

	it('deletes the rows of one story only', async () => {
		await upsertStoryViewerDataCache(cacheEntry(STORY, 'access-a'));
		await upsertStoryViewerDataCache(cacheEntry(CHAT_STORY, 'access-a'));

		await deleteStoryViewerDataCache(STORY.storyId);

		await expect(db.select().from(s.storyViewerDataCache)).resolves.toMatchObject([
			{ storyId: CHAT_STORY.storyId },
		]);
		await expect(getProjectViewerCacheRevision(PROJECT_ID)).resolves.toBe(0);
	});

	it('retires every viewer cache of a project, standalone or in a chat, and leaves other projects alone', async () => {
		await upsertStoryViewerDataCache(cacheEntry(STORY, 'access-a'));
		await upsertStoryViewerDataCache(cacheEntry(CHAT_STORY, 'access-a'));
		await upsertStoryViewerDataCache(cacheEntry(OTHER_PROJECT_STORY, 'access-a'));

		await invalidateProjectViewerCaches(PROJECT_ID);

		await expect(getProjectViewerCacheRevision(PROJECT_ID)).resolves.toBe(1);
		await expect(getProjectViewerCacheRevision(OTHER_PROJECT_ID)).resolves.toBe(0);
		await expect(db.select().from(s.storyViewerDataCache)).resolves.toMatchObject([
			{ storyId: OTHER_PROJECT_STORY.storyId },
		]);
	});
});

function cacheKey(story: typeof STORY, permissionRevision: string) {
	return { ...story, userId: VIEWER_ID, permissionRevision };
}

function cacheEntry(story: typeof STORY, permissionRevision: string) {
	return {
		...cacheKey(story, permissionRevision),
		queryData: { q_revenue: { columns: ['revenue'], data: [{ revenue: 1 }] } },
		code: '# Viewer story',
		analysisResults: { summary: 'Viewer summary' },
		cachedAt: new Date(),
	};
}
