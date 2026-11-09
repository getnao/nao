import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	acquireStoryEditLock,
	assertStoryEditable,
	getStoryEditLockState,
	releaseAgentStoryEditLocks,
	releaseStoryEditLock,
	renewAgentStoryEditLocks,
	STORY_EDIT_LOCK_TTL_MS,
	StoryEditLockedError,
} from '../src/services/story-edit-lock.service';

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

const PROJECT_ID = 'lock-project';
const OWNER_ID = 'lock-owner';
const EDITOR_ID = 'lock-editor';
const CHAT_ID = 'lock-chat';
const EDITOR_CHAT_ID = 'lock-editor-chat';
const STORY_ID = 'lock-story';

const OWNER_BY_HAND = { userId: OWNER_ID, chatId: null };
const EDITOR_BY_HAND = { userId: EDITOR_ID, chatId: null };
const EDITOR_AGENT = { userId: EDITOR_ID, chatId: EDITOR_CHAT_ID };
const OWNER_FIRST_TAB = { userId: OWNER_ID, chatId: null, sessionId: 'first-tab' };
const OWNER_SECOND_TAB = { userId: OWNER_ID, chatId: null, sessionId: 'second-tab' };

describe('story edit lock', () => {
	beforeAll(seed);

	beforeEach(async () => {
		vi.useRealTimers();
		await db.delete(s.storyEditLock);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('lets one person edit at a time and names them to the others', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);

		await expect(acquireStoryEditLock(STORY_ID, EDITOR_BY_HAND)).rejects.toEqual(new StoryEditLockedError('Owner'));
		expect(await getStoryEditLockState(STORY_ID, EDITOR_BY_HAND)).toEqual({
			holderName: 'Owner',
			isMine: false,
			isYou: false,
			byAgent: false,
		});
		expect(await getStoryEditLockState(STORY_ID, OWNER_BY_HAND)).toMatchObject({ isMine: true });
	});

	it('pushes the expiry back when the holder renews the lock', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);
		const firstExpiry = await readLockExpiry();

		await ageLock(STORY_EDIT_LOCK_TTL_MS / 2);
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);

		expect(await readLockExpiry()).toBeGreaterThanOrEqual(firstExpiry);
	});

	it('judges expiry by the database clock, whatever the clock of the host asking', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);

		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + STORY_EDIT_LOCK_TTL_MS * 2);

		await expect(acquireStoryEditLock(STORY_ID, EDITOR_BY_HAND)).rejects.toBeInstanceOf(StoryEditLockedError);
		expect(await getStoryEditLockState(STORY_ID, EDITOR_BY_HAND)).toMatchObject({ holderName: 'Owner' });
	});

	it('tells two tabs of the same person apart', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_FIRST_TAB);

		await expect(acquireStoryEditLock(STORY_ID, OWNER_SECOND_TAB)).rejects.toBeInstanceOf(StoryEditLockedError);
		expect(await getStoryEditLockState(STORY_ID, OWNER_SECOND_TAB)).toMatchObject({
			isMine: false,
			isYou: true,
			byAgent: false,
		});

		await releaseStoryEditLock(STORY_ID, OWNER_SECOND_TAB);
		expect(await getStoryEditLockState(STORY_ID, OWNER_FIRST_TAB)).toMatchObject({ isMine: true });
	});

	it('lets a person save from any of their tabs, but never over someone else', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_FIRST_TAB);

		await expect(assertStoryEditable(STORY_ID, OWNER_BY_HAND)).resolves.toBeUndefined();
		await expect(assertStoryEditable(STORY_ID, EDITOR_BY_HAND)).rejects.toEqual(new StoryEditLockedError('Owner'));
	});

	it('keeps the story of a running agent locked while it thinks between two writes', async () => {
		await acquireStoryEditLock(STORY_ID, EDITOR_AGENT);

		await ageLock(STORY_EDIT_LOCK_TTL_MS - 1_000);
		await renewAgentStoryEditLocks(EDITOR_CHAT_ID);
		await ageLock(STORY_EDIT_LOCK_TTL_MS - 1_000);

		await expect(acquireStoryEditLock(STORY_ID, OWNER_BY_HAND)).rejects.toBeInstanceOf(StoryEditLockedError);
	});

	it('does not bring back a lock that already expired', async () => {
		await acquireStoryEditLock(STORY_ID, EDITOR_AGENT);

		await ageLock(STORY_EDIT_LOCK_TTL_MS + 1);
		await renewAgentStoryEditLocks(EDITOR_CHAT_ID);

		expect(await getStoryEditLockState(STORY_ID, OWNER_BY_HAND)).toBeNull();
	});

	it('keeps a person from editing by hand while an agent edits, and frees the story when the run ends', async () => {
		await acquireStoryEditLock(STORY_ID, EDITOR_AGENT);

		await expect(acquireStoryEditLock(STORY_ID, OWNER_BY_HAND)).rejects.toBeInstanceOf(StoryEditLockedError);
		expect(await getStoryEditLockState(STORY_ID, OWNER_BY_HAND)).toMatchObject({
			holderName: 'Editor',
			byAgent: true,
		});

		await releaseAgentStoryEditLocks(EDITOR_CHAT_ID);

		await expect(acquireStoryEditLock(STORY_ID, OWNER_BY_HAND)).resolves.toBeUndefined();
	});

	it('only lets the holder release the lock', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);

		await releaseStoryEditLock(STORY_ID, EDITOR_BY_HAND);
		expect(await getStoryEditLockState(STORY_ID, EDITOR_BY_HAND)).not.toBeNull();

		await releaseStoryEditLock(STORY_ID, OWNER_BY_HAND);
		expect(await getStoryEditLockState(STORY_ID, EDITOR_BY_HAND)).toBeNull();
	});

	it('frees the story once a holder stops renewing the lock', async () => {
		await acquireStoryEditLock(STORY_ID, OWNER_BY_HAND);

		await ageLock(STORY_EDIT_LOCK_TTL_MS + 1);

		expect(await getStoryEditLockState(STORY_ID, EDITOR_BY_HAND)).toBeNull();
		await expect(acquireStoryEditLock(STORY_ID, EDITOR_BY_HAND)).resolves.toBeUndefined();
		expect(await getStoryEditLockState(STORY_ID, OWNER_BY_HAND)).toMatchObject({ holderName: 'Editor' });
	});
});

/** Moves the lock's expiry back, as if that much time had passed on the database clock. */
async function ageLock(elapsedMs: number): Promise<void> {
	await db
		.update(s.storyEditLock)
		.set({ expiresAt: new Date((await readLockExpiry()) - elapsedMs) })
		.where(eq(s.storyEditLock.storyId, STORY_ID));
}

async function readLockExpiry(): Promise<number> {
	const [lock] = await db
		.select({ expiresAt: s.storyEditLock.expiresAt })
		.from(s.storyEditLock)
		.where(eq(s.storyEditLock.storyId, STORY_ID));
	return lock.expiresAt.getTime();
}

async function seed() {
	await db.insert(s.user).values([
		{ id: OWNER_ID, name: 'Owner', email: 'lock-owner@example.com' },
		{ id: EDITOR_ID, name: 'Editor', email: 'lock-editor@example.com' },
	]);
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Locks', type: 'local', path: '/tmp/locks' });
	await db.insert(s.chat).values([
		{ id: CHAT_ID, userId: OWNER_ID, projectId: PROJECT_ID, title: 'Revenue analysis' },
		{ id: EDITOR_CHAT_ID, userId: EDITOR_ID, projectId: PROJECT_ID, title: 'Editor chat' },
	]);
	await db.insert(s.story).values({ id: STORY_ID, chatId: CHAT_ID, slug: 'revenue', title: 'Revenue' });
}
