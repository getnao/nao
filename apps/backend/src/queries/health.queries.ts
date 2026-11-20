import { sql } from 'drizzle-orm';

import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

let pendingHealthQuery: Promise<boolean> | undefined;

export async function checkDatabaseConnection(timeoutMs?: number): Promise<boolean> {
	const query = sharePendingHealthQuery();
	if (timeoutMs === undefined) {
		return query;
	}
	return Promise.race([query, resolveFalseAfter(timeoutMs)]);
}

/** Reuses the in-flight query so probes against a stalled database cannot pile up abandoned work. */
function sharePendingHealthQuery(): Promise<boolean> {
	pendingHealthQuery ??= runHealthQuery()
		.then(
			() => true,
			() => false,
		)
		.finally(() => {
			pendingHealthQuery = undefined;
		});
	return pendingHealthQuery;
}

async function runHealthQuery(): Promise<unknown> {
	if (dbConfig.dialect === Dialect.Postgres) {
		return (db as unknown as { execute(query: ReturnType<typeof sql>): Promise<unknown> }).execute(sql`select 1`);
	}
	return db.run(sql`select 1`);
}

function resolveFalseAfter(timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(false), timeoutMs).unref();
	});
}
