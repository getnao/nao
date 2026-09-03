import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		DB_QUERY_LOGGING: false,
		DB_URI: 'sqlite:./db.sqlite',
		NAO_DEFAULT_PROJECT_PATH: '/tmp/project-a',
	},
	isCloud: true,
}));

vi.mock('../src/env', () => ({
	env: mocks.env,
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle('./db.sqlite', { schema }) };
});

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { organization, orgMember, project, user } from '../src/db/sqlite-schema';
import { getProjectByUserId } from '../src/queries/project.queries';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });
const ORGANIZATION_A_ID = 'project-selection-org-a';
const ORGANIZATION_B_ID = 'project-selection-org-b';
const PROJECT_A_ID = 'project-selection-project-a';
const PROJECT_B_ID = 'project-selection-project-b';
const USER_B_ID = 'project-selection-user-b';

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
		appDb.$client.close();
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
});

async function cleanup() {
	await db.delete(orgMember).where(eq(orgMember.userId, USER_B_ID));
	await db.delete(project).where(inArray(project.id, [PROJECT_A_ID, PROJECT_B_ID]));
	await db.delete(organization).where(inArray(organization.id, [ORGANIZATION_A_ID, ORGANIZATION_B_ID]));
	await db.delete(user).where(eq(user.id, USER_B_ID));
}
