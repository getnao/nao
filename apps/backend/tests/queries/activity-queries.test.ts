import '../../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { listContextPullActivities, listRecentActivities } from '../../src/queries/activity.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'activity-project';
const USER_ID = 'activity-user';
const ACTOR_ID = 'activity-actor';

describe('context pull activity queries', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: USER_ID, name: 'Activity User', email: 'activity@example.com' },
			{ id: ACTOR_ID, name: 'Activity Actor', email: 'actor@example.com' },
		]);
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, name: 'Activity Project', type: 'local', path: '/tmp/activity-project' });
		await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: USER_ID, role: 'user' });
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

	it('hides group-scoped activity from inactive memberships and archived groups', async () => {
		await db
			.insert(s.userGroup)
			.values({ id: 'activity-group', projectId: PROJECT_ID, name: 'Activity Group' })
			.onConflictDoNothing();
		await db.insert(s.userGroupMember).values({ groupId: 'activity-group', userId: USER_ID }).onConflictDoNothing();
		await db
			.insert(s.chat)
			.values({ id: 'activity-chat', projectId: PROJECT_ID, userId: USER_ID, title: 'Activity Chat' })
			.onConflictDoNothing();
		await db
			.insert(s.sharedChat)
			.values({ id: 'activity-share', chatId: 'activity-chat', visibility: 'specific' })
			.onConflictDoNothing();
		await db
			.insert(s.sharedChatGroupAccess)
			.values({ sharedChatId: 'activity-share', groupId: 'activity-group' })
			.onConflictDoNothing();
		await db.insert(s.activity).values({
			id: 'group-activity',
			projectId: PROJECT_ID,
			userId: ACTOR_ID,
			type: 'chat.shared',
			status: 'completed',
			trigger: 'manual',
			sharedChatId: 'activity-share',
			completedAt: new Date(),
		});
		expect(await listRecentActivities(PROJECT_ID, USER_ID, 10)).toHaveLength(1);

		await db
			.update(s.userGroupMember)
			.set({ active: false })
			.where(eq(s.userGroupMember.groupId, 'activity-group'));
		expect(await listRecentActivities(PROJECT_ID, USER_ID, 10)).toHaveLength(0);

		await db.update(s.userGroupMember).set({ active: true }).where(eq(s.userGroupMember.groupId, 'activity-group'));
		await db
			.update(s.userGroup)
			.set({ archivedAt: new Date(), archivedName: 'Activity Group', name: '__archived__activity-group' })
			.where(eq(s.userGroup.id, 'activity-group'));
		expect(await listRecentActivities(PROJECT_ID, USER_ID, 10)).toHaveLength(0);
	});
});
