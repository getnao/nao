import { Database as Sqlite } from 'bun:sqlite';
import { BunSQLiteDatabase, drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import dbConfig, { Dialect } from './dbConfig';
import * as pgSchema from './pgSchema';
import * as sqliteSchema from './sqliteSchema';

function createDb() {
	if (dbConfig.dialect === Dialect.Postgres) {
		const ssl = process.env.DB_SSL === 'true' ? 'require' : undefined;
		const sql = postgres(dbConfig.dbUrl, { ssl });
		return drizzlePostgres(sql, { schema: pgSchema });
	} else {
		const sqlite = new Sqlite(dbConfig.dbUrl);
		sqlite.run('PRAGMA foreign_keys = ON;');
		return drizzleBunSqlite(sqlite, { schema: sqliteSchema });
	}
}

export const db = createDb() as BunSQLiteDatabase<typeof sqliteSchema> & {
	$client: Sqlite;
};
