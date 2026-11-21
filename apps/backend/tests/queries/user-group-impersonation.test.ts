import '../../src/env';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getUserRoleInProject } from '../../src/queries/project.queries';
import { startGroupImpersonation, stopGroupImpersonation } from '../../src/queries/user-group-impersonation.queries';
import { getShareAudience } from '../../src/services/project-sharing.service';
import { resolveAvailableUserGroupAccess } from '../../src/services/user-group-availability.service';

vi.mock('../../src/services/license.service', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/license.service')>()),
	hasFeature: vi.fn(async () => true),
}));

const mode = vi.hoisted(() => ({ isCloud: false }));

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
	get isCloud() {
		return mode.isCloud;
	},
}));

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'impersonation-project';
const ADMIN_ID = 'impersonation-admin';
const FINANCE_GROUP_ID = 'impersonation-finance';
const SALES_GROUP_ID = 'impersonation-sales';

beforeAll(seed);

afterAll(() => {
	db.$client.close();
});

describe('user group impersonation', () => {
	it('gives an admin the impersonated groups and a member role until they stop', async () => {
		await startGroupImpersonation(PROJECT_ID, ADMIN_ID, [FINANCE_GROUP_ID]);

		expect(await getUserRoleInProject(PROJECT_ID, ADMIN_ID)).toBe('user');
		expect((await resolveAvailableUserGroupAccess(PROJECT_ID, ADMIN_ID)).groupNames.sort()).toEqual([
			'All Users',
			'Finance',
		]);

		await stopGroupImpersonation(PROJECT_ID, ADMIN_ID);

		expect(await getUserRoleInProject(PROJECT_ID, ADMIN_ID)).toBe('admin');
		expect((await resolveAvailableUserGroupAccess(PROJECT_ID, ADMIN_ID)).groupNames.sort()).toEqual([
			'All Users',
			'Sales',
		]);
	});

	it('shares like a member of the impersonated groups', async () => {
		expect((await getShareAudience(PROJECT_ID, ADMIN_ID)).canShareToProject).toBe(true);

		await startGroupImpersonation(PROJECT_ID, ADMIN_ID, [FINANCE_GROUP_ID]);

		expect((await getShareAudience(PROJECT_ID, ADMIN_ID)).canShareToProject).toBe(false);

		await stopGroupImpersonation(PROJECT_ID, ADMIN_ID);
	});

	it('ignores a stored impersonation once its owner is no longer admin', async () => {
		await startGroupImpersonation(PROJECT_ID, ADMIN_ID, [FINANCE_GROUP_ID]);
		await setAdminRole('user');

		expect((await resolveAvailableUserGroupAccess(PROJECT_ID, ADMIN_ID)).groupNames.sort()).toEqual([
			'All Users',
			'Sales',
		]);

		await setAdminRole('admin');
		await stopGroupImpersonation(PROJECT_ID, ADMIN_ID);
	});

	it('ignores a stored impersonation on nao Cloud', async () => {
		await startGroupImpersonation(PROJECT_ID, ADMIN_ID, [FINANCE_GROUP_ID]);
		mode.isCloud = true;

		expect(await getUserRoleInProject(PROJECT_ID, ADMIN_ID)).toBe('admin');
		expect((await resolveAvailableUserGroupAccess(PROJECT_ID, ADMIN_ID)).groupNames.sort()).toEqual([
			'All Users',
			'Sales',
		]);

		mode.isCloud = false;
		await stopGroupImpersonation(PROJECT_ID, ADMIN_ID);
	});
});

async function setAdminRole(role: 'admin' | 'user') {
	await db
		.update(s.projectMember)
		.set({ role })
		.where(and(eq(s.projectMember.projectId, PROJECT_ID), eq(s.projectMember.userId, ADMIN_ID)));
}

async function seed() {
	await db.insert(s.user).values({ id: ADMIN_ID, name: ADMIN_ID, email: `${ADMIN_ID}@example.com` });
	await db.insert(s.project).values({ id: PROJECT_ID, name: 'Impersonation', type: 'local', path: '/tmp/imp' });
	await db.insert(s.projectMember).values({ projectId: PROJECT_ID, userId: ADMIN_ID, role: 'admin' });
	await db.insert(s.userGroup).values([
		{ id: 'impersonation-default', projectId: PROJECT_ID, name: 'All Users', isDefault: true },
		{
			id: FINANCE_GROUP_ID,
			projectId: PROJECT_ID,
			name: 'Finance',
			featureGrants: { version: 2, features: [], projectSharing: 'blocked' },
		},
		{ id: SALES_GROUP_ID, projectId: PROJECT_ID, name: 'Sales' },
	]);
	await db.insert(s.userGroupMember).values({ groupId: SALES_GROUP_ID, userId: ADMIN_ID });
}
