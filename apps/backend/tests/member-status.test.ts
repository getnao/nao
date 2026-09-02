import '../src/env';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { listOrgMembersWithUsers } from '../src/queries/organization.queries';
import { listProjectMembersWithRoles } from '../src/queries/project.queries';
import { deleteExpiredInvitations } from '../src/queries/user.queries';

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

const ORG_ID = 'status-org';
const PROJECT_ID = 'status-project';
const ACTIVE_USER_ID = 'active-user';
const LOGGED_OUT_USER_ID = 'logged-out-user';
const INVITED_USER_ID = 'invited-user';

const EXPECTED_STATUSES = {
	[ACTIVE_USER_ID]: 'active',
	[LOGGED_OUT_USER_ID]: 'active',
	[INVITED_USER_ID]: 'invited',
};

describe('member status', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values({ id: ORG_ID, name: 'Status Org', slug: 'status-org' });
		await db
			.insert(s.project)
			.values({ id: PROJECT_ID, orgId: ORG_ID, name: 'Status Project', type: 'local', path: '/tmp' });
		await db.insert(s.user).values([
			{ id: ACTIVE_USER_ID, name: 'Active', email: 'active@example.com' },
			{ id: LOGGED_OUT_USER_ID, name: 'Logged out', email: 'logged-out@example.com' },
			{ id: INVITED_USER_ID, name: 'Invited', email: 'invited@example.com', requiresPasswordReset: true },
		]);
		await db.insert(s.session).values({
			id: 'session-1',
			token: 'token-1',
			userId: ACTIVE_USER_ID,
			expiresAt: new Date(Date.now() + 60_000),
			updatedAt: new Date(),
		});
		await db.insert(s.orgMember).values([
			{ orgId: ORG_ID, userId: ACTIVE_USER_ID, role: 'admin' },
			{ orgId: ORG_ID, userId: LOGGED_OUT_USER_ID, role: 'user' },
			{ orgId: ORG_ID, userId: INVITED_USER_ID, role: 'user' },
		]);
		await db.insert(s.projectMember).values([
			{ projectId: PROJECT_ID, userId: ACTIVE_USER_ID, role: 'admin' },
			{ projectId: PROJECT_ID, userId: LOGGED_OUT_USER_ID, role: 'user' },
			{ projectId: PROJECT_ID, userId: INVITED_USER_ID, role: 'user' },
		]);
	});

	it('marks users who still have a temporary password as invited in organization members', async () => {
		const members = await listOrgMembersWithUsers(ORG_ID);

		expect(statusById(members)).toEqual(EXPECTED_STATUSES);
	});

	it('marks users who still have a temporary password as invited in project members', async () => {
		const members = await listProjectMembersWithRoles(PROJECT_ID);

		expect(statusById(members)).toEqual(EXPECTED_STATUSES);
	});
});

describe('expired invitation cleanup', () => {
	const EXPIRED_ID = 'expired-invite';
	const FRESH_ID = 'fresh-invite';
	const REISSUED_ID = 'reissued-invite';
	const ONBOARDING_ID = 'onboarding-invite';
	const LOGGED_OUT_OLD_ID = 'logged-out-old';
	const MESSAGING_ID = 'messaging-invite';

	beforeAll(async () => {
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		await db.insert(s.organization).values({ id: 'cleanup-org', name: 'Cleanup Org', slug: 'cleanup-org' });
		await db.insert(s.project).values({
			id: 'cleanup-project',
			orgId: 'cleanup-org',
			name: 'Cleanup Project',
			type: 'local',
			path: '/tmp/cleanup',
		});
		await db.insert(s.user).values([
			{ ...invitedUser(EXPIRED_ID), createdAt: eightDaysAgo, updatedAt: eightDaysAgo },
			invitedUser(FRESH_ID),
			{ ...invitedUser(REISSUED_ID), createdAt: eightDaysAgo },
			{ ...invitedUser(ONBOARDING_ID), createdAt: eightDaysAgo, updatedAt: eightDaysAgo },
			{ ...invitedUser(MESSAGING_ID), createdAt: eightDaysAgo, updatedAt: eightDaysAgo },
			{
				id: LOGGED_OUT_OLD_ID,
				name: LOGGED_OUT_OLD_ID,
				email: `${LOGGED_OUT_OLD_ID}@example.com`,
				createdAt: eightDaysAgo,
				updatedAt: eightDaysAgo,
			},
		]);
		await db.insert(s.session).values({
			id: 'session-onboarding',
			token: 'token-onboarding',
			userId: ONBOARDING_ID,
			expiresAt: new Date(Date.now() + 60_000),
			updatedAt: new Date(),
		});
		await db.insert(s.chat).values({
			id: 'chat-1',
			userId: MESSAGING_ID,
			projectId: 'cleanup-project',
			title: 'Slack thread',
		});
	});

	it('deletes only invitations whose temporary password is over 7 days old and unused', async () => {
		await deleteExpiredInvitations();

		const remaining = await db.select({ id: s.user.id }).from(s.user).execute();
		const remainingIds = remaining.map((user) => user.id);
		expect(remainingIds).not.toContain(EXPIRED_ID);
		expect(remainingIds).toEqual(
			expect.arrayContaining([FRESH_ID, REISSUED_ID, ONBOARDING_ID, LOGGED_OUT_OLD_ID, MESSAGING_ID]),
		);
	});
});

function invitedUser(id: string) {
	return { id, name: id, email: `${id}@example.com`, requiresPasswordReset: true };
}

function statusById(members: { id: string; status: string }[]): Record<string, string> {
	return Object.fromEntries(members.map((member) => [member.id, member.status]));
}
