import Database from 'better-sqlite3';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as sqliteSchema from '../../src/db/sqlite-schema';

/**
 * Fresh SQLite database with the full app schema, meant to replace `src/db/db` through `vi.mock`.
 * Every test file gets its own instance because vitest isolates module registries per file.
 */
export const createInMemoryDb = async () => {
	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return drizzle(sqlite, { schema: sqliteSchema });
};

/** better-sqlite3 transactions cannot await, so async transaction callbacks run directly on the database. */
export const createInMemoryDbWithInlineTransactions = async () => {
	const database = await createInMemoryDb();
	return Object.assign(database, {
		transaction: (run: (tx: typeof database) => Promise<unknown>) => run(database),
	});
};
