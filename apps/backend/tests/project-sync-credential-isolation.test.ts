import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getProjectEnvVarsByIdentity } from '../src/queries/project.queries';
import { getProjectWarehouseCredentialsByIdentity } from '../src/queries/project-warehouse-credentials.queries';

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

describe('project sync credential isolation', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values([
			{ id: 'org-a', name: 'Organization A', slug: 'org-a' },
			{ id: 'org-b', name: 'Organization B', slug: 'org-b' },
		]);
		await db.insert(s.project).values([
			{
				id: 'project-a',
				orgId: 'org-a',
				name: 'Project A',
				type: 'local',
				path: '/tmp/project-a',
				envVars: { PROJECT_SECRET: 'secret-a' },
			},
			{
				id: 'project-b',
				orgId: 'org-b',
				name: 'Project B',
				type: 'local',
				path: '/tmp/project-b',
				envVars: { PROJECT_SECRET: 'secret-b' },
			},
		]);
		await db.insert(s.projectWarehouseCredentials).values([
			{ projectId: 'project-a', provider: 'postgres', encryptedCredentials: 'warehouse-a' },
			{ projectId: 'project-b', provider: 'postgres', encryptedCredentials: 'warehouse-b' },
		]);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('returns credentials only when both project and organization identity match', async () => {
		await expect(getProjectEnvVarsByIdentity('project-a', 'org-a')).resolves.toEqual({
			PROJECT_SECRET: 'secret-a',
		});
		await expect(getProjectWarehouseCredentialsByIdentity('project-a', 'org-a')).resolves.toMatchObject({
			projectId: 'project-a',
			encryptedCredentials: 'warehouse-a',
		});

		await expect(getProjectEnvVarsByIdentity('project-a', 'org-b')).resolves.toBeNull();
		await expect(getProjectWarehouseCredentialsByIdentity('project-a', 'org-b')).resolves.toBeNull();
		await expect(getProjectEnvVarsByIdentity('project-b', 'org-a')).resolves.toBeNull();
		await expect(getProjectWarehouseCredentialsByIdentity('project-b', 'org-a')).resolves.toBeNull();
	});
});
