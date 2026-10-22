import '../src/env';

import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getFirstProjectAdminUserId } from '../src/queries/context-recommendation.queries';
import {
	addOrgMember,
	addOrgMemberIfMissing,
	countOrgAdmins,
	getOrgMember,
	removeOrgMember,
	removeOrgMemberFromProjects,
} from '../src/queries/organization.queries';
import {
	addProjectMember,
	getProjectMember,
	getUserRoleInProject,
	listUserProjects,
	removeProjectMember,
	updateProjectMemberRole,
} from '../src/queries/project.queries';
import { reconcileSsoUserGroupMemberships } from '../src/queries/sso-user-group-membership.queries';
import { isUserConfinedToOrganization } from '../src/queries/user.queries';
import { addProjectMemberWithUserGroups } from '../src/services/project-user-group-membership.service';

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

const ORG_ID = 'soft-org';
const OTHER_ORG_ID = 'soft-other-org';
const PROJECT_ID = 'soft-project';
const OTHER_PROJECT_ID = 'soft-other-project';
const MEMBER_ID = 'soft-member';
const ADMIN_ID = 'soft-admin';
const GROUP_ID = 'soft-group';

describe('soft-deleted memberships', () => {
	beforeEach(async () => {
		await db.delete(s.userGroupMember);
		await db.delete(s.userGroup);
		await db.delete(s.projectMember);
		await db.delete(s.orgMember);
		await db.delete(s.project);
		await db.delete(s.organization);
		await db.delete(s.user);

		await db.insert(s.user).values([
			{ id: MEMBER_ID, name: 'Member', email: 'member@example.com' },
			{ id: ADMIN_ID, name: 'Admin', email: 'admin@example.com' },
		]);
		await db.insert(s.organization).values([
			{ id: ORG_ID, name: 'Soft Org', slug: 'soft-org' },
			{ id: OTHER_ORG_ID, name: 'Other Org', slug: 'soft-other-org' },
		]);
		await db.insert(s.project).values([
			{ id: PROJECT_ID, orgId: ORG_ID, name: 'Soft', type: 'local', path: '/tmp/soft' },
			{ id: OTHER_PROJECT_ID, orgId: OTHER_ORG_ID, name: 'Elsewhere', type: 'local', path: '/tmp/elsewhere' },
		]);
	});

	it('keeps the row and stamps deletedAt instead of deleting it', async () => {
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });

		await removeProjectMember(PROJECT_ID, MEMBER_ID);

		const [row] = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(row).toMatchObject({ isDeleted: true, role: 'user' });
		expect(row?.deletedAt).toBeInstanceOf(Date);
		expect(await getProjectMember(PROJECT_ID, MEMBER_ID)).toBeNull();
	});

	it('reactivates the existing row when a removed member is re-added', async () => {
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);

		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'admin' });

		const rows = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ isDeleted: false, deletedAt: null, role: 'admin' });
	});

	it('reactivates a removed organization membership on re-add', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await removeOrgMember(ORG_ID, MEMBER_ID);
		expect(await getOrgMember(ORG_ID, MEMBER_ID)).toBeNull();

		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'admin' });

		const rows = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, MEMBER_ID));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ isDeleted: false, deletedAt: null, role: 'admin' });
	});

	it('falls back to the inherited org role once the project membership is removed', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'admin' });
		expect(await getUserRoleInProject(PROJECT_ID, MEMBER_ID)).toBe('admin');

		await removeProjectMember(PROJECT_ID, MEMBER_ID);
		expect(await getUserRoleInProject(PROJECT_ID, MEMBER_ID)).toBe('user');

		await removeOrgMember(ORG_ID, MEMBER_ID);
		expect(await getUserRoleInProject(PROJECT_ID, MEMBER_ID)).toBeNull();
	});

	it('excludes removed admins from the last-admin count', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: ADMIN_ID, role: 'admin' });
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'admin' });
		expect(await countOrgAdmins(ORG_ID)).toBe(2);

		await removeOrgMember(ORG_ID, MEMBER_ID);

		expect(await countOrgAdmins(ORG_ID)).toBe(1);
	});

	it('stops listing a project for a removed member', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		expect(await listUserProjects(MEMBER_ID)).toHaveLength(1);

		await removeProjectMember(PROJECT_ID, MEMBER_ID);
		expect(await listUserProjects(MEMBER_ID)).toHaveLength(1);

		await removeOrgMember(ORG_ID, MEMBER_ID);
		expect(await listUserProjects(MEMBER_ID)).toEqual([]);
	});

	it('ignores a removed foreign membership when confining a user to one organization', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addOrgMember({ orgId: OTHER_ORG_ID, userId: MEMBER_ID, role: 'user' });
		expect(await isUserConfinedToOrganization(MEMBER_ID, ORG_ID)).toBe(false);

		await removeOrgMember(OTHER_ORG_ID, MEMBER_ID);

		expect(await isUserConfinedToOrganization(MEMBER_ID, ORG_ID)).toBe(true);
	});

	it('reactivates a soft-deleted row through addOrgMemberIfMissing', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await removeOrgMember(ORG_ID, MEMBER_ID);

		await addOrgMemberIfMissing({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });

		const rows = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, MEMBER_ID));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ isDeleted: false, deletedAt: null });
	});

	it('resets the role when addOrgMemberIfMissing reactivates a removed member', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'admin' });
		await removeOrgMember(ORG_ID, MEMBER_ID);

		// this is the path every self-hosted SSO login takes, so a removed admin must not
		// come back as an admin just because their old row carried that role
		await addOrgMemberIfMissing({ orgId: ORG_ID, userId: MEMBER_ID, role: 'viewer' });

		const rows = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, MEMBER_ID));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ role: 'viewer', isDeleted: false, deletedAt: null });
	});

	it('reactivates an SSO-mapped project membership with the group role', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'admin' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);
		await db.insert(s.userGroup).values({
			id: GROUP_ID,
			projectId: PROJECT_ID,
			name: 'SSO Group',
			ssoMappings: {
				version: 1,
				providers: { oidc: ['engineering'], microsoft: [] },
				defaultProjectRole: 'viewer',
			},
		});

		await reconcileSsoUserGroupMemberships(MEMBER_ID, 'oidc', ['engineering']);

		const rows = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ role: 'viewer', isDeleted: false, deletedAt: null });
	});

	it('leaves an active membership untouched when addOrgMemberIfMissing runs again', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'admin' });

		await addOrgMemberIfMissing({ orgId: ORG_ID, userId: MEMBER_ID, role: 'viewer' });

		const rows = await db.select().from(s.orgMember).where(eq(s.orgMember.userId, MEMBER_ID));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ role: 'admin', isDeleted: false });
	});

	it('preserves the original deletedAt when the same member is removed twice', async () => {
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);
		const [first] = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));

		await new Promise((resolve) => setTimeout(resolve, 5));
		await removeProjectMember(PROJECT_ID, MEMBER_ID);

		const rows = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ isDeleted: true });
		expect(rows[0]?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
		expect(await getProjectMember(PROJECT_ID, MEMBER_ID)).toBeNull();
	});

	it('does not rewrite deletedAt on unrelated projects when an org member is removed', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);
		const [early] = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));

		await new Promise((resolve) => setTimeout(resolve, 5));
		await removeOrgMemberFromProjects(ORG_ID, MEMBER_ID);

		const [after] = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(after?.deletedAt?.getTime()).toBe(early?.deletedAt?.getTime());
	});

	it('does not apply a role change to a removed membership', async () => {
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);

		await updateProjectMemberRole(PROJECT_ID, MEMBER_ID, 'admin');

		const [row] = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(row).toMatchObject({ role: 'user', isDeleted: true });
	});

	it('reactivates through the SQLite user-group add path', async () => {
		await db.insert(s.userGroup).values({ id: GROUP_ID, projectId: PROJECT_ID, name: 'Soft Group' });
		await addProjectMember({ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		await removeProjectMember(PROJECT_ID, MEMBER_ID);

		const created = await addProjectMemberWithUserGroups(
			{ projectId: PROJECT_ID, userId: MEMBER_ID, role: 'admin' },
			[GROUP_ID],
		);

		expect(created).toMatchObject({ isDeleted: false, role: 'admin' });
		const rows = await db
			.select()
			.from(s.projectMember)
			.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, MEMBER_ID)));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ isDeleted: false, deletedAt: null });
	});

	it('elects an org admin once their explicit project role is removed', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: ADMIN_ID, role: 'admin' });
		await addProjectMember({ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'user' });
		// an org admin holding an explicit non-admin project role is deliberately not elected
		await expect(getFirstProjectAdminUserId(PROJECT_ID)).rejects.toThrow('No admin found');

		await removeProjectMember(PROJECT_ID, ADMIN_ID);

		// the soft-deleted row must not keep masking the inherited org-admin role
		expect(await getFirstProjectAdminUserId(PROJECT_ID)).toBe(ADMIN_ID);
	});

	it('ignores a removed foreign project membership when confining a user', async () => {
		await addOrgMember({ orgId: ORG_ID, userId: MEMBER_ID, role: 'user' });
		await addProjectMember({ projectId: OTHER_PROJECT_ID, userId: MEMBER_ID, role: 'user' });
		expect(await isUserConfinedToOrganization(MEMBER_ID, ORG_ID)).toBe(false);

		await removeProjectMember(OTHER_PROJECT_ID, MEMBER_ID);

		expect(await isUserConfinedToOrganization(MEMBER_ID, ORG_ID)).toBe(true);
	});
});
