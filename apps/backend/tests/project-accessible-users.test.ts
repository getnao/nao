import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
});

import '../src/env';

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { organization, orgMember, project, projectMember, user } from '../src/db/sqlite-schema';
import { env, isCloud } from '../src/env';
import { listOrgProjectsWithAccess } from '../src/queries/organization.queries';
import {
	getProjectByUserId,
	getUserRoleInProject,
	listProjectMembersWithRoles,
	listUserProjectsWithRoles,
	listUsersWithProjectAccess,
} from '../src/queries/project.queries';

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle('./db.sqlite', { schema }) };
});

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

async function cleanup() {
	await db.delete(projectMember).where(eq(projectMember.projectId, 'pau-proj'));
	await db.delete(projectMember).where(eq(projectMember.projectId, 'pau-solo'));
	await db.delete(orgMember).where(eq(orgMember.orgId, 'pau-org'));
	await db.delete(project).where(eq(project.id, 'pau-proj'));
	await db.delete(project).where(eq(project.id, 'pau-solo'));
	await db.delete(organization).where(eq(organization.id, 'pau-org'));
	await db.delete(user).where(eq(user.id, 'pau-direct'));
	await db.delete(user).where(eq(user.id, 'pau-org-only'));
	await db.delete(user).where(eq(user.id, 'pau-org-admin'));
	await db.delete(user).where(eq(user.id, 'pau-both'));
	await db.delete(user).where(eq(user.id, 'pau-ctx'));
	await db.delete(user).where(eq(user.id, 'pau-none'));
}

describe('project accessible users', () => {
	const originalDefaultProjectPath = env.NAO_DEFAULT_PROJECT_PATH;

	beforeEach(async () => {
		await cleanup();
		env.NAO_DEFAULT_PROJECT_PATH = '/tmp/pau';
		await db.insert(organization).values({ id: 'pau-org', name: 'PAU', slug: 'pau-org' });
		await db.insert(project).values([
			{ id: 'pau-proj', orgId: 'pau-org', name: 'PAU', type: 'local', path: '/tmp/pau' },
			{ id: 'pau-solo', orgId: null, name: 'PAU Solo', type: 'local', path: '/tmp/pau-solo' },
		]);
		db.$client
			.prepare('insert into user (id, name, email, messaging_provider_code) values (?, ?, ?, ?)')
			.run('pau-direct', 'PAU Direct', 'pau-direct@example.com', 'pau-secret-code');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-org-only', 'PAU Org Only', 'pau-org-only@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-org-admin', 'PAU Org Admin', 'pau-org-admin@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-both', 'PAU Both', 'pau-both@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-ctx', 'PAU Ctx', 'pau-ctx@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-none', 'PAU None', 'pau-none@example.com');
		await db.insert(projectMember).values([
			{ projectId: 'pau-proj', userId: 'pau-direct', role: 'admin' },
			{ projectId: 'pau-proj', userId: 'pau-both', role: 'viewer' },
			{ projectId: 'pau-proj', userId: 'pau-ctx', role: 'context_admin' },
			{ projectId: 'pau-solo', userId: 'pau-direct', role: 'admin' },
		]);
		await db.insert(orgMember).values([
			{ orgId: 'pau-org', userId: 'pau-org-only', role: 'user' },
			{ orgId: 'pau-org', userId: 'pau-org-admin', role: 'admin' },
			{ orgId: 'pau-org', userId: 'pau-both', role: 'admin' },
		]);
	});

	afterEach(async () => {
		env.NAO_DEFAULT_PROJECT_PATH = originalDefaultProjectPath;
		await cleanup();
	});

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('includes org members alongside direct project members, project role wins', async () => {
		const users = await listUsersWithProjectAccess('pau-proj');
		const rolesById = new Map(users.map(({ id, role }) => [id, role]));

		expect([...rolesById.keys()].sort()).toEqual([
			'pau-both',
			'pau-ctx',
			'pau-direct',
			'pau-org-admin',
			'pau-org-only',
		]);
		expect(rolesById.get('pau-direct')).toBe('admin');
		expect(rolesById.get('pau-org-only')).toBe('user');
		expect(rolesById.get('pau-org-admin')).toBe('admin');
		expect(rolesById.get('pau-both')).toBe('viewer');
		expect(rolesById.get('pau-ctx')).toBe('context_admin');
	});

	it('team listing still excludes org-only members', async () => {
		const teamUsers = await listProjectMembersWithRoles('pau-proj');

		expect(teamUsers.map(({ id }) => id).sort()).toEqual(['pau-both', 'pau-ctx', 'pau-direct']);
	});

	it('omits messaging provider codes from user listings', async () => {
		const accessibleUsers = await listUsersWithProjectAccess('pau-proj');
		const teamUsers = await listProjectMembersWithRoles('pau-proj');

		expect(accessibleUsers.every((accessibleUser) => !('messagingProviderCode' in accessibleUser))).toBe(true);
		expect(teamUsers.every((teamUser) => !('messagingProviderCode' in teamUser))).toBe(true);
	});

	it('self-hosted project without org returns only direct members', async () => {
		const soloUsers = await listUsersWithProjectAccess('pau-solo');

		expect(soloUsers.map(({ id }) => id).sort()).toEqual(['pau-direct']);
	});

	it('returns the self-hosted project for an org-only member', async () => {
		expect(isCloud).toBe(false);

		const result = await getProjectByUserId('pau-org-only');

		expect(result?.id).toBe('pau-proj');
	});

	it('resolves an org-only member role from the organization', async () => {
		const role = await getUserRoleInProject('pau-proj', 'pau-org-only');

		expect(role).toBe('user');
	});

	it('prefers a project member role over the organization role', async () => {
		const role = await getUserRoleInProject('pau-proj', 'pau-both');

		expect(role).toBe('viewer');
	});

	it('returns inherited organization roles in user project listings', async () => {
		const userProjects = await listUserProjectsWithRoles('pau-org-only');
		const adminProjects = await listUserProjectsWithRoles('pau-org-admin');

		expect(userProjects).toHaveLength(1);
		expect(userProjects[0]?.userRole).toBe('user');
		expect(adminProjects).toHaveLength(1);
		expect(adminProjects[0]?.userRole).toBe('admin');
	});

	it('returns inherited organization roles in organization project listings', async () => {
		const userProjects = await listOrgProjectsWithAccess('pau-org', 'pau-org-only');
		const adminProjects = await listOrgProjectsWithAccess('pau-org', 'pau-org-admin');

		expect(userProjects).toHaveLength(1);
		expect(userProjects[0]?.role).toBe('user');
		expect(adminProjects).toHaveLength(1);
		expect(adminProjects[0]?.role).toBe('admin');
	});

	it('prefers explicit roles in both project listings', async () => {
		const userProjects = await listUserProjectsWithRoles('pau-both');
		const orgProjects = await listOrgProjectsWithAccess('pau-org', 'pau-both');

		expect(userProjects).toHaveLength(1);
		expect(userProjects[0]?.userRole).toBe('viewer');
		expect(orgProjects).toHaveLength(1);
		expect(orgProjects[0]?.role).toBe('viewer');
	});

	it('returns null for a user without project or organization membership', async () => {
		const result = await getProjectByUserId('pau-none');

		expect(result).toBeNull();
	});
});
