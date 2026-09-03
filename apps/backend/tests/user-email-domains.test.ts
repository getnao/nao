import '../src/env';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getUser } from '../src/queries/user.queries';

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

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

describe('getUser email variations', () => {
	beforeEach(async () => {
		await db.delete(s.user);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('prefers an exact email match', async () => {
		await db.insert(s.user).values([
			{ id: 'exact', name: 'Exact User', email: 'alex@new.example' },
			{
				id: 'alias',
				name: 'Alias User',
				email: 'alex@old.example',
				emailVariations: ['alex@new.example'],
			},
		]);

		const user = await getUser({ email: 'alex@new.example' });

		expect(user?.id).toBe('exact');
	});

	it('finds a unique user through a linked email variation', async () => {
		await db.insert(s.user).values({
			id: 'alias',
			name: 'Alias User',
			email: 'alex@old.example',
			emailVariations: ['alex@new.example'],
		});

		const user = await getUser({ email: 'ALEX@NEW.EXAMPLE' });

		expect(user?.id).toBe('alias');
	});

	it('returns null when a linked domain is ambiguous', async () => {
		await db.insert(s.user).values([
			{
				id: 'first',
				name: 'First User',
				email: 'alex@first.example',
				emailVariations: ['alex@new.example'],
			},
			{
				id: 'second',
				name: 'Second User',
				email: 'alex@second.example',
				emailVariations: ['alex@new.example'],
			},
		]);

		const user = await getUser({ email: 'alex@new.example' });

		expect(user).toBeNull();
	});
});
