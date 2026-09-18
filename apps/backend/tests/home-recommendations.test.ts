import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getHomeRecommendations } from '../src/services/home-recommendations';
import { refineRecommendationsWithAi } from '../src/services/home-recommendations-ai';

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

vi.mock('../src/services/home-recommendations-ai', () => ({
	refineRecommendationsWithAi: vi.fn(async () => null),
}));

const PROJECT_ID = 'home-project';
const USER_ID = 'home-user';
const COLLEAGUE_ID = 'home-colleague';
const TIMEZONE = 'Europe/Paris';
/** Wednesday 2026-09-16 09:00 in Paris. */
const NOW = new Date('2026-09-16T07:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;

function daysAgo(days: number, hourOffset = 0): Date {
	return new Date(NOW.getTime() - days * DAY_MS + hourOffset * 60 * 60 * 1_000);
}

async function logStoryView(storyId: string, chatId: string, createdAt: Date) {
	await db.insert(s.analyticsEvent).values({
		projectId: PROJECT_ID,
		type: 'page_view',
		assetType: 'story',
		actorUserId: USER_ID,
		storyId,
		chatId,
		createdAt,
	});
}

async function logChatView(chatId: string, createdAt: Date, sharedChatId: string | null = null) {
	await db.insert(s.analyticsEvent).values({
		projectId: PROJECT_ID,
		type: 'page_view',
		assetType: 'chat',
		actorUserId: USER_ID,
		chatId,
		sharedChatId,
		createdAt,
	});
}

describe('getHomeRecommendations', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: USER_ID, name: 'Home User', email: 'home@example.com' },
			{ id: COLLEAGUE_ID, name: 'Colleague', email: 'colleague@example.com' },
		]);
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Home', type: 'local', path: '/tmp/home' });
		await db.insert(s.projectMember).values([
			{ projectId: PROJECT_ID, userId: USER_ID, role: 'user' },
			{ projectId: PROJECT_ID, userId: COLLEAGUE_ID, role: 'user' },
		]);

		await db.insert(s.chat).values([
			{ id: 'morning-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'Morning sales chat' },
			{ id: 'evening-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'End of day wrap-up' },
			{ id: 'deleted-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'Gone', deletedAt: daysAgo(1) },
			{ id: 'colleague-chat', userId: COLLEAGUE_ID, projectId: PROJECT_ID, title: 'Shared by colleague' },
			{ id: 'private-chat', userId: COLLEAGUE_ID, projectId: PROJECT_ID, title: 'No longer shared' },
		]);
		await db
			.insert(s.sharedChat)
			.values({ id: 'colleague-share', chatId: 'colleague-chat', visibility: 'project' });
		await db.insert(s.story).values([
			{ id: 'kpi-story', chatId: 'morning-chat', projectId: PROJECT_ID, slug: 'kpi', title: 'Daily KPIs' },
			{
				id: 'archived-story',
				chatId: 'morning-chat',
				projectId: PROJECT_ID,
				slug: 'old',
				title: 'Archived',
				archivedAt: daysAgo(1),
			},
		]);
		await db.insert(s.chatMessage).values([
			{ id: 'm1', chatId: 'morning-chat', role: 'user', createdAt: daysAgo(3) },
			{ id: 'm2', chatId: 'morning-chat', role: 'assistant', createdAt: daysAgo(3) },
		]);

		for (const day of [1, 2, 5, 6, 7]) {
			await logStoryView('kpi-story', 'morning-chat', daysAgo(day));
			await logChatView('morning-chat', daysAgo(day, 0.25));
			await logChatView('evening-chat', daysAgo(day, 9));
		}
		await logChatView('deleted-chat', daysAgo(1));
		await logStoryView('archived-story', 'morning-chat', daysAgo(1));
		await logChatView('colleague-chat', daysAgo(2), 'colleague-share');
		await logChatView('private-chat', daysAgo(2));
	});

	afterAll(() => {
		db.$client.close();
	});

	it('ranks the morning habits first and only keeps assets the user can still open', async () => {
		const result = await getHomeRecommendations({
			userId: USER_ID,
			projectId: PROJECT_ID,
			timezone: TIMEZONE,
			limit: 6,
			now: NOW,
		});

		expect(result.source).toBe('frecency');
		expect(result.items.map((item) => item.id)).toEqual([
			'kpi-story',
			'morning-chat',
			'evening-chat',
			'colleague-chat',
		]);

		const story = result.items[0];
		expect(story).toMatchObject({ kind: 'story', title: 'Daily KPIs', isOwn: true, shareId: null });
		expect(story.reason).toBe('You usually open this around now on weekdays');

		const chat = result.items[1];
		expect(chat).toMatchObject({ kind: 'chat', title: 'Morning sales chat', isOwn: true });
		expect(chat.messageBubbles).toEqual([
			{ role: 'user', charCount: 0 },
			{ role: 'assistant', charCount: 0 },
		]);

		const shared = result.items[3];
		expect(shared).toMatchObject({
			kind: 'chat',
			isOwn: false,
			shareId: 'colleague-share',
			authorName: 'Colleague',
		});
	});

	it('respects the limit and surfaces the evening chat in the evening', async () => {
		const result = await getHomeRecommendations({
			userId: USER_ID,
			projectId: PROJECT_ID,
			timezone: TIMEZONE,
			limit: 1,
			now: daysAgo(0, 9),
		});

		expect(result.items.map((item) => item.id)).toEqual(['evening-chat']);
	});

	it('uses the AI ordering when the re-ranker answers', async () => {
		vi.mocked(refineRecommendationsWithAi).mockImplementationOnce(async ({ candidates, limit }) => {
			const evening = candidates.find(({ item }) => item.id === 'evening-chat')!;
			return [{ ...evening.item, reason: 'Your end-of-day wrap-up' }, ...candidates.map((c) => c.item)].slice(
				0,
				limit,
			);
		});

		const result = await getHomeRecommendations({
			userId: USER_ID,
			projectId: PROJECT_ID,
			timezone: TIMEZONE,
			limit: 2,
			now: NOW,
		});

		expect(result.source).toBe('ai');
		expect(result.items.map((item) => item.id)).toEqual(['evening-chat', 'kpi-story']);
		expect(result.items[0].reason).toBe('Your end-of-day wrap-up');
		expect(vi.mocked(refineRecommendationsWithAi)).toHaveBeenLastCalledWith(
			expect.objectContaining({ localNow: 'Wednesday 9am', limit: 2 }),
		);
	});

	it('returns nothing for a user without history', async () => {
		const result = await getHomeRecommendations({
			userId: COLLEAGUE_ID,
			projectId: PROJECT_ID,
			timezone: TIMEZONE,
			limit: 6,
			now: NOW,
		});
		expect(result).toEqual({ items: [], source: 'frecency' });
	});
});
