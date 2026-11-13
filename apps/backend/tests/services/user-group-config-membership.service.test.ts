import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { reconcileUserGroupConfigMembershipsForUser } from '../../src/services/user-group-config-membership.service';

const PROJECT_ID = 'pending-membership-project';
const USER_ID = 'pending-membership-user';
const GROUP_ID = 'pending-membership-group';

async function setup() {
	await db.insert(s.user).values({
		id: USER_ID,
		name: 'Pending user',
		email: 'member@example.com',
		requiresPasswordReset: true,
	});
	await db.insert(s.project).values({
		id: PROJECT_ID,
		name: 'Pending memberships',
		type: 'local',
		path: '/tmp/pending-memberships',
		userGroupManagementMode: 'code',
	});
	await db.insert(s.userGroup).values({
		id: GROUP_ID,
		projectId: PROJECT_ID,
		name: 'Finance',
		configKey: 'finance',
	});
	await db
		.insert(s.userGroupConfigMember)
		.values({ groupId: GROUP_ID, normalizedEmail: 'member@example.com', active: true });
	await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: USER_ID, role: 'user' });
}

describe('pending user group config memberships', () => {
	it('resolves an unverified invited project user when its email matches uniquely', async () => {
		await setup();
		await reconcileUserGroupConfigMembershipsForUser(USER_ID);
		expect(await activeMembershipCount()).toBe(1);

		await db.insert(s.user).values({
			id: 'ambiguous-membership-user',
			name: 'Ambiguous user',
			email: 'MEMBER@example.com',
		});
		await db
			.insert(s.projectMember)
			.values({ projectId: PROJECT_ID, userId: 'ambiguous-membership-user', role: 'user' });
		await reconcileUserGroupConfigMembershipsForUser('ambiguous-membership-user');
		expect(await activeMembershipCount()).toBe(0);

		await db.update(s.user).set({ email: 'other@example.com' }).where(eq(s.user.id, 'ambiguous-membership-user'));
		await reconcileUserGroupConfigMembershipsForUser(USER_ID);
		expect(await activeMembershipCount()).toBe(1);
	});
});

async function activeMembershipCount(): Promise<number> {
	const rows = await db
		.select({ active: s.userGroupMember.active })
		.from(s.userGroupMember)
		.where(and(eq(s.userGroupMember.groupId, GROUP_ID), eq(s.userGroupMember.provider, 'config')));
	return rows.filter((row) => row.active).length;
}
