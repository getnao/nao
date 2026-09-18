import { and, eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

const isPostgres = dbConfig.dialect === Dialect.Postgres;

const databaseNow = isPostgres ? sql`now()` : sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const tryAcquireLock = async (key: string, owner: string, leaseMs: number): Promise<boolean> => {
	const expiresAt = leaseExpiry(leaseMs);
	const rows = await db
		.insert(s.keyedLock)
		.values({ key, owner, expiresAt })
		.onConflictDoUpdate({
			target: s.keyedLock.key,
			set: { owner, expiresAt },
			setWhere: sql`${s.keyedLock.expiresAt} < ${databaseNow}`,
		})
		.returning({ key: s.keyedLock.key })
		.execute();
	return rows.length > 0;
};

export const renewLock = async (key: string, owner: string, leaseMs: number): Promise<boolean> => {
	const rows = await db
		.update(s.keyedLock)
		.set({ expiresAt: leaseExpiry(leaseMs) })
		.where(and(eq(s.keyedLock.key, key), eq(s.keyedLock.owner, owner)))
		.returning({ key: s.keyedLock.key })
		.execute();
	return rows.length > 0;
};

export const releaseLock = async (key: string, owner: string): Promise<void> => {
	await db
		.delete(s.keyedLock)
		.where(and(eq(s.keyedLock.key, key), eq(s.keyedLock.owner, owner)))
		.execute();
};

function leaseExpiry(leaseMs: number) {
	if (isPostgres) {
		return sql`${databaseNow} + make_interval(secs => ${leaseMs} / 1000.0)`;
	}
	return sql`${databaseNow} + ${leaseMs}`;
}
