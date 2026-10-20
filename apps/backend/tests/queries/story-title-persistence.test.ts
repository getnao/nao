import '../../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../src/db/db';
import { chat, project, story, user } from '../../src/db/sqlite-schema';
import {
	createStandaloneVersion,
	createStoryVersion,
	getStandaloneStoryByUserAndSlug,
	getStoryByChatAndSlug,
	renameStory,
} from '../../src/queries/story.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const userId = 'story-title-persistence-user';
const projectId = 'story-title-persistence-project';
const chatId = 'story-title-persistence-chat';

async function cleanup() {
	await db.delete(story).where(eq(story.projectId, projectId));
	await db.delete(story).where(eq(story.chatId, chatId));
	await db.delete(chat).where(eq(chat.id, chatId));
	await db.delete(project).where(eq(project.id, projectId));
	await db.delete(user).where(eq(user.id, userId));
}

describe('story title persistence', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(user).values({ id: userId, name: 'Story Owner', email: 'story-title-persistence@example.com' });
		await db.insert(project).values({
			id: projectId,
			name: 'Story Title Persistence',
			type: 'local',
			path: '/tmp/story-title-persistence',
		});
		await db.insert(chat).values({ id: chatId, userId, projectId });
	});

	afterEach(cleanup);

	afterAll(() => {
		db.$client.close();
	});

	it('keeps a renamed chat story title when creating another version', async () => {
		await createStoryVersion({
			chatId,
			slug: 'chat-story',
			title: 'Original title',
			code: '# Version 1',
			action: 'create',
			source: 'user',
		});
		const story = await getStoryByChatAndSlug(chatId, 'chat-story');
		expect(story).not.toBeNull();

		await renameStory(story!.id, 'Renamed title');
		const version = await createStoryVersion({
			chatId,
			slug: 'chat-story',
			title: 'Original title',
			code: '# Version 2',
			action: 'update',
			source: 'user',
		});

		const stored = await getStoryByChatAndSlug(chatId, 'chat-story');
		expect(version.title).toBe('Renamed title');
		expect(stored?.title).toBe('Renamed title');
		expect(stored?.slug).toBe('chat-story');
	});

	it('keeps a renamed standalone story title when creating another version', async () => {
		await createStandaloneVersion({
			userId,
			projectId,
			slug: 'standalone-story',
			title: 'Original title',
			code: '# Version 1',
			action: 'create',
			source: 'user',
		});
		const story = await getStandaloneStoryByUserAndSlug(userId, projectId, 'standalone-story');
		expect(story).not.toBeNull();

		await renameStory(story!.id, 'Renamed title');
		const version = await createStandaloneVersion({
			userId,
			projectId,
			slug: 'standalone-story',
			title: 'Original title',
			code: '# Version 2',
			action: 'update',
			source: 'user',
		});

		const stored = await getStandaloneStoryByUserAndSlug(userId, projectId, 'standalone-story');
		expect(version.title).toBe('Renamed title');
		expect(stored?.title).toBe('Renamed title');
		expect(stored?.slug).toBe('standalone-story');
	});
});
