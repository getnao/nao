import { sql } from 'drizzle-orm';

import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

export async function checkDatabaseConnection(timeoutMs?: number): Promise<boolean> {
	const query = runHealthQuery().then(
		() => true,
		() => false,
	);
	if (timeoutMs === undefined) {
		return query;
	}
	return Promise.race([query, rejectAfterTimeout(timeoutMs)]);
}

async function runHealthQuery(): Promise<unknown> {
	if (dbConfig.dialect === Dialect.Postgres) {
		return (db as unknown as { execute(query: ReturnType<typeof sql>): Promise<unknown> }).execute(sql`select 1`);
	}
	return db.run(sql`select 1`);
}

function rejectAfterTimeout(timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(false), timeoutMs).unref();
	});
}
