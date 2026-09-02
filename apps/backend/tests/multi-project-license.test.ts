import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: {
		DB_QUERY_LOGGING: false,
		DB_URI: 'sqlite:./db.sqlite',
		NAO_DEFAULT_PROJECT_PATH: '/tmp/multi-project-default',
	},
	isCloud: true,
	hasFeature: vi.fn(),
}));

vi.mock('../src/env', () => ({
	env: mocks.env,
	get isCloud() {
		return mocks.isCloud;
	},
}));

vi.mock('../src/services/license.service', () => ({
	hasFeature: mocks.hasFeature,
	LICENSE_FEATURES: { multiProject: 'multi-project' },
}));

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle('./db.sqlite', { schema }) };
});

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { project, projectMember, user } from '../src/db/sqlite-schema';
import { getProjectByUserId } from '../src/queries/project.queries';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });
const USER_ID = 'multi-project-license-user';
const DEFAULT_PROJECT_ID = 'multi-project-license-default';
const SELECTED_PROJECT_ID = 'multi-project-license-selected';
const DEFAULT_PROJECT_PATH = '/tmp/multi-project-default';

describe('multi-project cloud gate', () => {
	beforeEach(async () => {
		await cleanup();
		mocks.isCloud = true;
		mocks.hasFeature.mockReset().mockResolvedValue(true);
		await db.insert(user).values({
			id: USER_ID,
			name: 'Multi Project User',
			email: 'multi-project-license@example.com',
		});
		await db.insert(project).values([
			{
				id: DEFAULT_PROJECT_ID,
				name: 'Default Project',
				type: 'local',
				path: DEFAULT_PROJECT_PATH,
			},
			{
				id: SELECTED_PROJECT_ID,
				name: 'Selected Project',
				type: 'local',
				path: '/tmp/multi-project-selected',
			},
		]);
		await db.insert(projectMember).values([
			{ projectId: DEFAULT_PROJECT_ID, userId: USER_ID, role: 'admin' },
			{ projectId: SELECTED_PROJECT_ID, userId: USER_ID, role: 'admin' },
		]);
	});

	afterEach(cleanup);

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('honours the selected project in cloud mode with the multi-project feature', async () => {
		const result = await getProjectByUserId(USER_ID, SELECTED_PROJECT_ID);

		expect(result?.id).toBe(SELECTED_PROJECT_ID);
		expect(mocks.hasFeature).toHaveBeenCalledWith('multi-project');
	});

	it('falls back to the default project in cloud mode without the multi-project feature', async () => {
		mocks.hasFeature.mockResolvedValue(false);

		const result = await getProjectByUserId(USER_ID, SELECTED_PROJECT_ID);

		expect(result?.id).toBe(DEFAULT_PROJECT_ID);
		expect(mocks.hasFeature).toHaveBeenCalledWith('multi-project');
	});

	it('falls back to the default project outside cloud mode', async () => {
		mocks.isCloud = false;

		const result = await getProjectByUserId(USER_ID, SELECTED_PROJECT_ID);

		expect(result?.id).toBe(DEFAULT_PROJECT_ID);
		expect(mocks.hasFeature).not.toHaveBeenCalled();
	});
});

async function cleanup() {
	await db.delete(projectMember).where(eq(projectMember.userId, USER_ID));
	await db.delete(project).where(eq(project.id, DEFAULT_PROJECT_ID));
	await db.delete(project).where(eq(project.id, SELECTED_PROJECT_ID));
	await db.delete(user).where(eq(user.id, USER_ID));
}
