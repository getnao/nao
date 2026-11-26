import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		BETTER_AUTH_URL: 'http://localhost:5005/',
		DB_QUERY_LOGGING: false,
		DB_URI: 'sqlite:./db.sqlite',
		NAO_DEFAULT_PROJECT_PATH: '/tmp/project-a' as string | undefined,
		NAO_PROJECT_PATHS: [] as string[],
	},
	isCloud: true,
	hasFeature: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('../../src/env', () => ({
	env: mocks.env,
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../../src/services/license.service', () => ({
	LICENSE_FEATURES: { multiProject: 'multi-project' },
	hasFeature: mocks.hasFeature,
}));

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

import { db } from '../../src/db/db';
import { organization, orgMember, project, user } from '../../src/db/sqlite-schema';
import { getProjectByUserId, listUserProjects } from '../../src/queries/project.queries';

const ORGANIZATION_A_ID = 'project-selection-org-a';
const ORGANIZATION_B_ID = 'project-selection-org-b';
const PROJECT_A_ID = 'project-selection-project-a';
const PROJECT_B_ID = 'project-selection-project-b';
const USER_B_ID = 'project-selection-user-b';
const SALES_PROJECT_ID = 'project-selection-sales';
const FINANCE_PROJECT_ID = 'project-selection-finance';
const REMOVED_PROJECT_ID = 'project-selection-removed';
const SALES_PATH = '/tmp/projects/sales';
const FINANCE_PATH = '/tmp/projects/finance';
const REMOVED_PATH = '/tmp/projects/removed';

describe('project selection', () => {
	beforeEach(async () => {
		await cleanup();
		mocks.isCloud = true;
		mocks.env.NAO_DEFAULT_PROJECT_PATH = '/tmp/project-a';

		await db.insert(organization).values([
			{ id: ORGANIZATION_A_ID, name: 'Organization A', slug: 'project-selection-org-a' },
			{ id: ORGANIZATION_B_ID, name: 'Organization B', slug: 'project-selection-org-b' },
		]);
		await db.insert(user).values({
			id: USER_B_ID,
			name: 'User B',
			email: 'project-selection-user-b@example.com',
		});
		await db.insert(project).values([
			{
				id: PROJECT_A_ID,
				orgId: ORGANIZATION_A_ID,
				name: 'Project A',
				type: 'local',
				path: '/tmp/project-a',
			},
			{
				id: PROJECT_B_ID,
				orgId: ORGANIZATION_B_ID,
				name: 'Project B',
				type: 'local',
				path: '/tmp/project-b',
			},
		]);
		await db.insert(orgMember).values({
			orgId: ORGANIZATION_B_ID,
			userId: USER_B_ID,
			role: 'user',
		});
	});

	afterEach(cleanup);

	afterAll(() => {
		db.$client.close();
	});

	it('returns an accessible selected project in cloud mode', async () => {
		const result = await getProjectByUserId(USER_B_ID, PROJECT_B_ID);

		expect(result?.id).toBe(PROJECT_B_ID);
	});

	it('falls back to the first accessible project when no project is selected', async () => {
		const result = await getProjectByUserId(USER_B_ID);

		expect(result?.id).toBe(PROJECT_B_ID);
	});

	it('falls back to the first accessible project when the selection is inaccessible', async () => {
		const result = await getProjectByUserId(USER_B_ID, PROJECT_A_ID);

		expect(result?.id).toBe(PROJECT_B_ID);
	});

	it('answers no project for an inaccessible selection when the caller refuses the fallback', async () => {
		const result = await getProjectByUserId(USER_B_ID, PROJECT_A_ID, { fallbackWhenInaccessible: false });

		expect(result).toBeNull();
	});

	it('returns null in cloud mode when the user has no accessible projects', async () => {
		const result = await getProjectByUserId('project-selection-unknown-user', PROJECT_A_ID);

		expect(result).toBeNull();
	});

	it('uses the configured project and verifies access in self-hosted mode', async () => {
		mocks.isCloud = false;
		mocks.env.NAO_DEFAULT_PROJECT_PATH = '/tmp/project-b';

		const result = await getProjectByUserId(USER_B_ID, PROJECT_A_ID);

		expect(result?.id).toBe(PROJECT_B_ID);
	});

	describe('self-hosted multi-project', () => {
		beforeEach(async () => {
			mocks.isCloud = false;
			mocks.env.NAO_DEFAULT_PROJECT_PATH = undefined;
			mocks.env.NAO_PROJECT_PATHS = [SALES_PATH, FINANCE_PATH];
			mocks.hasFeature.mockResolvedValue(true);

			await db.insert(project).values([
				{ id: SALES_PROJECT_ID, orgId: ORGANIZATION_B_ID, name: 'Sales', type: 'local', path: SALES_PATH },
				{
					id: FINANCE_PROJECT_ID,
					orgId: ORGANIZATION_B_ID,
					name: 'Finance',
					type: 'local',
					path: FINANCE_PATH,
				},
				{
					id: REMOVED_PROJECT_ID,
					orgId: ORGANIZATION_B_ID,
					name: 'Removed',
					type: 'local',
					path: REMOVED_PATH,
				},
			]);
		});

		it('returns the selected configured project', async () => {
			const result = await getProjectByUserId(USER_B_ID, FINANCE_PROJECT_ID);

			expect(result?.id).toBe(FINANCE_PROJECT_ID);
		});

		it('falls back to the first configured project rather than the alphabetical first', async () => {
			const result = await getProjectByUserId(USER_B_ID);

			expect(result?.id).toBe(SALES_PROJECT_ID);
		});

		it('hides projects whose path is no longer configured', async () => {
			const projects = await listUserProjects(USER_B_ID);

			expect(projects.map((p) => p.id).sort()).toEqual([FINANCE_PROJECT_ID, SALES_PROJECT_ID]);
			expect((await getProjectByUserId(USER_B_ID, REMOVED_PROJECT_ID))?.id).toBe(SALES_PROJECT_ID);
			expect((await listUserProjects(USER_B_ID, { includeInactive: true })).map((p) => p.id)).toContain(
				REMOVED_PROJECT_ID,
			);
		});

		it('only serves the default project without the Enterprise license', async () => {
			mocks.hasFeature.mockResolvedValue(false);

			const result = await getProjectByUserId(USER_B_ID, FINANCE_PROJECT_ID);

			expect(result?.id).toBe(SALES_PROJECT_ID);
			expect((await listUserProjects(USER_B_ID)).map((p) => p.id)).toEqual([SALES_PROJECT_ID]);
		});
	});
});

async function cleanup() {
	mocks.hasFeature.mockReset();
	mocks.env.NAO_PROJECT_PATHS = [];
	await db.delete(orgMember).where(eq(orgMember.userId, USER_B_ID));
	await db
		.delete(project)
		.where(
			inArray(project.id, [PROJECT_A_ID, PROJECT_B_ID, SALES_PROJECT_ID, FINANCE_PROJECT_ID, REMOVED_PROJECT_ID]),
		);
	await db.delete(organization).where(inArray(organization.id, [ORGANIZATION_A_ID, ORGANIZATION_B_ID]));
	await db.delete(user).where(eq(user.id, USER_B_ID));
}
