import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
});

import '../../src/env';

import { db } from '../../src/db/db';
import { organization, orgMember, project, projectMember, user } from '../../src/db/sqlite-schema';
import { getFirstProjectAdminUserId } from '../../src/queries/context-recommendation.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_IDS = ['cra-direct', 'cra-inherited', 'cra-solo'];
const USER_IDS = ['cra-project-admin', 'cra-org-admin', 'cra-demoted-org-admin'];

async function cleanup() {
	await db.delete(projectMember).where(inArray(projectMember.projectId, PROJECT_IDS));
	await db.delete(orgMember).where(eq(orgMember.orgId, 'cra-org'));
	await db.delete(project).where(inArray(project.id, PROJECT_IDS));
	await db.delete(organization).where(eq(organization.id, 'cra-org'));
	await db.delete(user).where(inArray(user.id, USER_IDS));
}

describe('getFirstProjectAdminUserId', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values({ id: 'cra-org', name: 'CRA', slug: 'cra-org' });
		await db.insert(project).values([
			{ id: 'cra-direct', orgId: 'cra-org', name: 'CRA Direct', type: 'local', path: '/tmp/cra-direct' },
			{ id: 'cra-inherited', orgId: 'cra-org', name: 'CRA Inherited', type: 'local', path: '/tmp/cra-inherited' },
			{ id: 'cra-solo', orgId: null, name: 'CRA Solo', type: 'local', path: '/tmp/cra-solo' },
		]);
		for (const userId of USER_IDS) {
			db.$client
				.prepare('insert into user (id, name, email) values (?, ?, ?)')
				.run(userId, userId, `${userId}@example.com`);
		}
		await db.insert(orgMember).values([
			{ orgId: 'cra-org', userId: 'cra-demoted-org-admin', role: 'admin', createdAt: new Date('2026-01-01') },
			{ orgId: 'cra-org', userId: 'cra-org-admin', role: 'admin', createdAt: new Date('2026-02-01') },
		]);
		await db.insert(projectMember).values([
			{ projectId: 'cra-direct', userId: 'cra-project-admin', role: 'admin' },
			{ projectId: 'cra-inherited', userId: 'cra-demoted-org-admin', role: 'viewer' },
		]);
	});

	afterEach(async () => {
		await cleanup();
	});

	afterAll(() => {
		db.$client.close();
	});

	it('prefers a direct project admin over org admins', async () => {
		await expect(getFirstProjectAdminUserId('cra-direct')).resolves.toBe('cra-project-admin');
	});

	it('falls back to an org admin without an explicit project role', async () => {
		await expect(getFirstProjectAdminUserId('cra-inherited')).resolves.toBe('cra-org-admin');
	});

	it('throws when neither the project nor its org has an admin', async () => {
		await expect(getFirstProjectAdminUserId('cra-solo')).rejects.toThrow('No admin found for project cra-solo');
	});
});
