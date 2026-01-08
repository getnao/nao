import 'dotenv/config';

import { Database } from 'bun:sqlite';
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { connectionString, isPostgres } from '../utils';
import * as postgresSchema from './pg-schema';
import * as sqliteSchema from './sqlite-schema';

function createDb() {
	if (isPostgres) {
		const sql = postgres(connectionString);
		return drizzlePostgres(sql, { schema: postgresSchema });
	} else {
		const sqlite = new Database(connectionString);
		return drizzleBunSqlite(sqlite, { schema: sqliteSchema });
	}
}

export const db = createDb();
