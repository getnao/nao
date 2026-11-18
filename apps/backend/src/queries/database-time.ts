import { sql } from 'drizzle-orm';

import dbConfig, { Dialect } from '../db/dbConfig';

const isPostgres = dbConfig.dialect === Dialect.Postgres;

/** The database clock, shared by every backend instance, unlike each host's own clock. */
export const databaseNow = isPostgres ? sql`now()` : sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export function databaseTimeIn(durationMs: number) {
	if (isPostgres) {
		return sql`${databaseNow} + make_interval(secs => ${durationMs} / 1000.0)`;
	}
	return sql`${databaseNow} + ${durationMs}`;
}
