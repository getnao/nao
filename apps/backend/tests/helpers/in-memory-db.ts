import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { inject } from 'vitest';

import * as sqliteSchema from '../../src/db/sqlite-schema';

/**
 * Fresh SQLite database with the full app schema, meant to replace `src/db/db` through `vi.mock`.
 * Every test file gets its own instance because the module registry is reset per file.
 */
export const createInMemoryDb = () => openDatabase(':memory:');

/** better-sqlite3 transactions cannot await, so async transaction callbacks run directly on the database. */
export const createInMemoryDbWithInlineTransactions = () => {
	const database = createInMemoryDb();
	return Object.assign(database, {
		transaction: (run: (tx: typeof database) => Promise<unknown>) => run(database),
	});
};

let temporaryFileDb: { path: string; db: ReturnType<typeof openDatabase> } | undefined;

/** The test file's own database file, for code that opens a connection from `dbConfig.dbUrl` instead of `db`. */
export function getTemporaryFileDb() {
	if (!temporaryFileDb) {
		const path = join(mkdtempSync(join(tmpdir(), 'nao-test-db-')), 'app.sqlite');
		temporaryFileDb = { path, db: openDatabase(path) };
	}
	return temporaryFileDb;
}

export function removeTemporaryFileDb(): void {
	if (!temporaryFileDb) {
		return;
	}
	temporaryFileDb.db.$client.close();
	rmSync(join(temporaryFileDb.path, '..'), { recursive: true, force: true });
	temporaryFileDb = undefined;
}

function openDatabase(filename: string) {
	const sqlite = new Database(filename);
	for (const statement of inject('sqliteSchemaStatements')) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return drizzle(sqlite, { schema: sqliteSchema });
}
