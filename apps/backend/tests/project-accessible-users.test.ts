import '../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { organization, orgMember, project, projectMember, user } from '../src/db/sqlite-schema';
import { listProjectMembersWithRoles, listUsersWithProjectAccess } from '../src/queries/project.queries';

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
	await db.delete(user).where(eq(user.id, 'pau-both'));
	await db.delete(user).where(eq(user.id, 'pau-ctx'));
}

describe('project accessible users', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values({ id: 'pau-org', name: 'PAU', slug: 'pau-org' });
		await db.insert(project).values([
			{ id: 'pau-proj', orgId: 'pau-org', name: 'PAU', type: 'local', path: '/tmp/pau' },
			{ id: 'pau-solo', orgId: null, name: 'PAU Solo', type: 'local', path: '/tmp/pau-solo' },
		]);
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-direct', 'PAU Direct', 'pau-direct@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-org-only', 'PAU Org Only', 'pau-org-only@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-both', 'PAU Both', 'pau-both@example.com');
		db.$client
			.prepare('insert into user (id, name, email) values (?, ?, ?)')
			.run('pau-ctx', 'PAU Ctx', 'pau-ctx@example.com');
		await db.insert(projectMember).values([
			{ projectId: 'pau-proj', userId: 'pau-direct', role: 'admin' },
			{ projectId: 'pau-proj', userId: 'pau-both', role: 'viewer' },
			{ projectId: 'pau-proj', userId: 'pau-ctx', role: 'context_admin' },
			{ projectId: 'pau-solo', userId: 'pau-direct', role: 'admin' },
		]);
		await db.insert(orgMember).values([
			{ orgId: 'pau-org', userId: 'pau-org-only', role: 'user' },
			{ orgId: 'pau-org', userId: 'pau-both', role: 'admin' },
		]);
	});

	afterEach(cleanup);

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('includes org members alongside direct project members, project role wins', async () => {
		const users = await listUsersWithProjectAccess('pau-proj');
		const rolesById = new Map(users.map(({ id, role }) => [id, role]));

		expect([...rolesById.keys()].sort()).toEqual(['pau-both', 'pau-ctx', 'pau-direct', 'pau-org-only']);
		expect(rolesById.get('pau-direct')).toBe('admin');
		expect(rolesById.get('pau-org-only')).toBe('user');
		expect(rolesById.get('pau-both')).toBe('viewer');
		expect(rolesById.get('pau-ctx')).toBe('context_admin');
	});

	it('team listing still excludes org-only members', async () => {
		const teamUsers = await listProjectMembersWithRoles('pau-proj');

		expect(teamUsers.map(({ id }) => id).sort()).toEqual(['pau-both', 'pau-ctx', 'pau-direct']);
	});

	it('self-hosted project without org returns only direct members', async () => {
		const soloUsers = await listUsersWithProjectAccess('pau-solo');

		expect(soloUsers.map(({ id }) => id).sort()).toEqual(['pau-direct']);
	});
});
