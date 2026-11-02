import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	failInterruptedProjectSyncActivities,
	failStaleActivities,
	getLatestCompletedProjectSync,
	listContextPullActivities,
} from '../src/queries/activity.queries';

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

	it("returns the project's newest completed sync with who ran it", async () => {
		await db.insert(s.project).values({ id: 'other-project', name: 'Other', type: 'local', path: '/tmp/other' });
		const at = (hour: number) => new Date(Date.UTC(2026, 9, 30, hour));
		const sync = (
			id: string,
			status: 'completed' | 'failed' | 'running',
			hour: number,
			projectId = PROJECT_ID,
		) => ({
			id,
			projectId,
			userId: USER_ID,
			type: 'project.synced' as const,
			status,
			startedAt: at(hour),
			completedAt: status === 'running' ? null : at(hour),
		});
		await db
			.insert(s.activity)
			.values([
				sync('older', 'completed', 9),
				sync('newest', 'completed', 10),
				sync('failed-later', 'failed', 11),
				sync('running-later', 'running', 12),
				sync('other-project-later', 'completed', 13, 'other-project'),
			]);

		await expect(getLatestCompletedProjectSync(PROJECT_ID)).resolves.toEqual({
			completedAt: at(10),
			actorName: 'Activity User',
		});
		await expect(getLatestCompletedProjectSync('project-without-syncs')).resolves.toBeNull();
	});

	it('leaves long project syncs running until a restart interrupts them', async () => {
		const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000);
		await db.insert(s.activity).values([
			{
				id: 'long-sync',
				projectId: PROJECT_ID,
				userId: USER_ID,
				type: 'project.synced',
				status: 'running',
				startedAt: longAgo,
			},
			{ id: 'running-pull', projectId: PROJECT_ID, userId: USER_ID, type: 'context.pulled', status: 'running' },
			{
				id: 'finished-sync',
				projectId: PROJECT_ID,
				userId: USER_ID,
				type: 'project.synced',
				status: 'completed',
			},
		]);

		await failStaleActivities();
		expect(await getStatus('long-sync')).toBe('running');

		await failInterruptedProjectSyncActivities();
		const [interrupted] = await db.select().from(s.activity).where(eq(s.activity.id, 'long-sync'));
		expect(interrupted).toMatchObject({ status: 'failed', errorMessage: 'Interrupted by a server restart.' });
		expect(await getStatus('running-pull')).toBe('running');
		expect(await getStatus('finished-sync')).toBe('completed');
	});
});

async function getStatus(activityId: string) {
	const [activity] = await db.select().from(s.activity).where(eq(s.activity.id, activityId));
	return activity.status;
}
