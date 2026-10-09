import '../src/env';

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { updateProjectSettings } from '../src/queries/project-settings.queries';

// The query picks its transaction shape from `dbConfig.dialect`, so pin the dialect to SQLite
// here — otherwise a runner with `DB_URI=postgres://…` takes the async path against the
// better-sqlite3 mock below and fails with "Transaction function cannot return a promise".
vi.mock('../src/db/dbConfig', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../src/db/dbConfig')>();
	return { ...mod, default: { ...mod.default, dialect: mod.Dialect.Sqlite } };
});

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

const PROJECT_ID = 'project-settings-project';

const readTeamsSettings = async () => {
	const [project] = await db.select().from(s.project).where(eq(s.project.id, PROJECT_ID)).execute();
	return project.teamsSettings;
};

describe('updateProjectSettings', () => {
	beforeAll(async () => {
		await db.insert(s.project).values({
			id: PROJECT_ID,
			name: 'Settings Project',
			type: 'local',
			path: '/tmp/project-settings-project',
		});
	});

	// The old `db.transaction(async …)` form failed this outright on better-sqlite3
	// ("Transaction function cannot return a promise"), which is why the body is synchronous there.
	it('rebuilds the settings blob without an async transaction callback', async () => {
		const updated = await updateProjectSettings(PROJECT_ID, 'teamsSettings', (existing) => ({
			teamsAppId: 'app-id',
			teamsAppPassword: 'app-password',
			teamsTenantId: 'tenant-id',
			teamsLlmProvider: existing?.teamsLlmProvider ?? 'openai',
			teamsLlmModelId: 'gpt-4o',
		}));

		expect(updated.teamsSettings?.teamsLlmModelId).toBe('gpt-4o');
		expect((await readTeamsSettings())?.teamsAppId).toBe('app-id');
	});

	it('rolls the write back when the builder throws', async () => {
		await expect(
			updateProjectSettings(PROJECT_ID, 'teamsSettings', () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		expect((await readTeamsSettings())?.teamsAppId).toBe('app-id');
	});

	it('leaves the row alone when the builder returns undefined', async () => {
		await updateProjectSettings(PROJECT_ID, 'slackSettings', () => undefined);

		const [project] = await db.select().from(s.project).where(eq(s.project.id, PROJECT_ID)).execute();
		expect(project.slackSettings).toBeNull();
	});
});
