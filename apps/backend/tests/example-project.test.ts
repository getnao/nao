import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { upsertSystemExampleProject } from '../src/queries/project.queries';

describe('system example project', () => {
	afterAll(() => db.$client.close());

	it('upserts the project with one fully granted default group', async () => {
		await upsertSystemExampleProject('/tmp/example-a');
		const stored = await upsertSystemExampleProject('/tmp/example-b');
		const groups = await db.select().from(s.userGroup).where(eq(s.userGroup.projectId, 'system-example-project'));

		expect(stored).toMatchObject({ id: 'system-example-project', path: '/tmp/example-b' });
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			name: 'All Users',
			isDefault: true,
			featureGrants: {
				version: 2,
				features: ['storyCreation', 'customStoryCreation', 'automationCreation'],
			},
			contextGrants: {
				version: 4,
				databaseAccess: { mode: 'all', strict: false },
				docsAccess: { mode: 'all' },
			},
		});
	});
});
