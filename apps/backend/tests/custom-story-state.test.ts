import '../src/env';

import { MAX_STORY_STATE_KEYS } from '@nao/shared/story-app';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { CustomStoryNotFoundError } from '../src/services/custom-story';
import {
	getCustomStoryState,
	getSharedCustomStoryState,
	InvalidStoryStateError,
	setCustomStoryState,
} from '../src/services/custom-story-state';

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

	const database = drizzle(sqlite, { schema: sqliteSchema });
	return {
		db: Object.assign(database, {
			transaction: (run: (tx: typeof database) => Promise<unknown>) => run(database),
		}),
	};
});

const CHAT = 'chat-1';
const SLUG = 'gauges';
const OWNER = 'owner';
const VIEWER = 'viewer';

function set(viewerId: string, key: string, value: unknown) {
	return setCustomStoryState(CHAT, SLUG, viewerId, { key, value });
}

describe('custom story state', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: OWNER, name: 'Sarah', email: 'owner@example.com' },
			{ id: VIEWER, name: 'Viewer', email: 'viewer@example.com' },
		]);
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: CHAT, projectId: 'project-1', userId: OWNER, title: 'Chat' });
		await db.insert(s.story).values([
			{ id: 'story-1', chatId: CHAT, slug: SLUG, title: 'Gauges', format: 'custom' },
			{ id: 'story-2', chatId: CHAT, slug: 'report', title: 'Report', format: 'classic' },
		]);
	});

	beforeEach(async () => {
		await db.delete(s.storyAppState);
	});

	it("saves the owner's changes as the shared view every viewer starts from", async () => {
		await set(OWNER, 'churn', 40);

		expect(await getCustomStoryState(CHAT, SLUG, OWNER)).toEqual({
			shared: { churn: 40 },
			own: {},
			isOwner: true,
			ownerName: 'Sarah',
		});
		expect(await getCustomStoryState(CHAT, SLUG, VIEWER)).toEqual({
			shared: { churn: 40 },
			own: {},
			isOwner: false,
			ownerName: 'Sarah',
		});
	});

	it("keeps another viewer's changes in their own view, never in the shared one", async () => {
		await set(OWNER, 'churn', 40);
		await set(VIEWER, 'churn', 70);

		expect((await getCustomStoryState(CHAT, SLUG, VIEWER)).own).toEqual({ churn: 70 });
		expect((await getCustomStoryState(CHAT, SLUG, OWNER)).shared).toEqual({ churn: 40 });
	});

	it('overwrites a key and removes it on null', async () => {
		await set(OWNER, 'slide', 2);
		await set(OWNER, 'slide', 5);
		expect((await getCustomStoryState(CHAT, SLUG, OWNER)).shared).toEqual({ slide: 5 });

		await set(OWNER, 'slide', null);
		expect((await getCustomStoryState(CHAT, SLUG, OWNER)).shared).toEqual({});
		expect(await db.select().from(s.storyAppState)).toHaveLength(0);
	});

	it('refuses invalid keys and values that are too large', async () => {
		await expect(set(OWNER, '../escape', 1)).rejects.toBeInstanceOf(InvalidStoryStateError);
		await expect(set(OWNER, 'big', 'x'.repeat(40 * 1024))).rejects.toBeInstanceOf(InvalidStoryStateError);
	});

	it('caps the number of keys per view but still lets existing ones change', async () => {
		for (let index = 0; index < MAX_STORY_STATE_KEYS; index++) {
			await set(OWNER, `key-${index}`, index);
		}

		await expect(set(OWNER, 'one-more', 1)).rejects.toBeInstanceOf(InvalidStoryStateError);
		await expect(set(OWNER, 'key-0', 'updated')).resolves.toBeUndefined();
		await expect(set(VIEWER, 'one-more', 1)).resolves.toBeUndefined();
	});

	it("renders unattended exports with the shared view only, never someone's own", async () => {
		await set(OWNER, 'round', 3);
		await set(VIEWER, 'churn', 70);

		expect(await getSharedCustomStoryState(CHAT, SLUG)).toEqual({ round: 3 });
	});

	it('only applies to custom stories', async () => {
		await expect(getCustomStoryState(CHAT, 'report', OWNER)).rejects.toBeInstanceOf(CustomStoryNotFoundError);
		await expect(setCustomStoryState(CHAT, 'report', OWNER, { key: 'a', value: 1 })).rejects.toBeInstanceOf(
			CustomStoryNotFoundError,
		);
	});
});
