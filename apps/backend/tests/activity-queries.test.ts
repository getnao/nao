import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { listContextPullActivities } from '../src/queries/activity.queries';

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

const PROJECT_ID = 'activity-project';
const USER_ID = 'activity-user';

describe('context pull activity queries', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: USER_ID, name: 'Activity User', email: 'activity@example.com' });
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, name: 'Activity Project', type: 'local', path: '/tmp/activity-project' });
	});

	beforeEach(async () => {
		await db.delete(s.activity);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('fails stale runs and returns only the latest bounded history', async () => {
		const now = Date.now();
		await db.insert(s.activity).values({
			id: 'stale',
			projectId: PROJECT_ID,
			userId: USER_ID,
			type: 'context.pulled',
			trigger: 'manual',
			status: 'running',
			startedAt: new Date(now - 31 * 60 * 1_000),
		});
		await db.insert(s.activity).values(
			Array.from({ length: 101 }, (_, index) => ({
				id: `recent-${index}`,
				projectId: PROJECT_ID,
				userId: USER_ID,
				type: 'context.pulled' as const,
				trigger: 'manual' as const,
				status: 'completed' as const,
				startedAt: new Date(now + index),
				completedAt: new Date(now + index),
			})),
		);

		const history = await listContextPullActivities(PROJECT_ID);
		const [stale] = await db.select().from(s.activity).where(eq(s.activity.id, 'stale'));

		expect(history).toHaveLength(100);
		expect(history.map(({ id }) => id)).toEqual(Array.from({ length: 100 }, (_, index) => `recent-${100 - index}`));
		expect(stale).toMatchObject({
			status: 'failed',
			errorMessage: 'Activity did not finish before the timeout.',
		});
		expect(stale.completedAt).toBeInstanceOf(Date);
	});
});
