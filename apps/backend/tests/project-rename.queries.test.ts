import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env', () => ({
	env: { BETTER_AUTH_URL: 'http://localhost:5005/', DB_QUERY_LOGGING: false, DB_URI: 'sqlite:./db.sqlite' },
	isCloud: true,
}));

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle('./db.sqlite', { schema }) };
});

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { organization, project } from '../src/db/sqlite-schema';
import { renameProject } from '../src/queries/project.queries';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });
const ORGANIZATION_A_ID = 'project-rename-org-a';
const ORGANIZATION_B_ID = 'project-rename-org-b';
const PROJECT_ID = 'project-rename-project';
const SIBLING_PROJECT_ID = 'project-rename-sibling';
const OTHER_ORG_PROJECT_ID = 'project-rename-other-org';
const PROJECT_IDS = [PROJECT_ID, SIBLING_PROJECT_ID, OTHER_ORG_PROJECT_ID];

describe('renameProject', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values([
			{ id: ORGANIZATION_A_ID, name: 'Organization A', slug: 'project-rename-org-a' },
			{ id: ORGANIZATION_B_ID, name: 'Organization B', slug: 'project-rename-org-b' },
		]);
		await db.insert(project).values([
			{ id: PROJECT_ID, orgId: ORGANIZATION_A_ID, name: "Ada's project", type: 'local', path: '/tmp/rename-a' },
			{ id: SIBLING_PROJECT_ID, orgId: ORGANIZATION_A_ID, name: 'Finance', type: 'local', path: '/tmp/rename-b' },
			{
				id: OTHER_ORG_PROJECT_ID,
				orgId: ORGANIZATION_B_ID,
				name: 'Marketing',
				type: 'local',
				path: '/tmp/rename-c',
			},
		]);
	});

	afterEach(cleanup);

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('renames the project to an unused name', async () => {
		await expect(renameProject(PROJECT_ID, ORGANIZATION_A_ID, 'Revenue')).resolves.toBe(true);

		expect(await getProjectName(PROJECT_ID)).toBe('Revenue');
	});

	it('leaves the project untouched when another project of the organization uses the name', async () => {
		await expect(renameProject(PROJECT_ID, ORGANIZATION_A_ID, 'Finance')).resolves.toBe(false);

		expect(await getProjectName(PROJECT_ID)).toBe("Ada's project");
	});

	it('allows a name used by a project of another organization', async () => {
		await expect(renameProject(PROJECT_ID, ORGANIZATION_A_ID, 'Marketing')).resolves.toBe(true);

		expect(await getProjectName(PROJECT_ID)).toBe('Marketing');
	});

	it('allows keeping the current name', async () => {
		await expect(renameProject(PROJECT_ID, ORGANIZATION_A_ID, "Ada's project")).resolves.toBe(true);
	});
});

async function getProjectName(projectId: string) {
	const [row] = await db.select({ name: project.name }).from(project).where(eq(project.id, projectId));
	return row?.name;
}

async function cleanup() {
	await db.delete(project).where(inArray(project.id, PROJECT_IDS));
	await db.delete(organization).where(inArray(organization.id, [ORGANIZATION_A_ID, ORGANIZATION_B_ID]));
}
