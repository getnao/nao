import { eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';

const isPostgres = dbConfig.dialect === Dialect.Postgres;

export const tryAcquireLock = async (key: string, leaseMs: number): Promise<boolean> => {
	const expiresAt = new Date(Date.now() + leaseMs);
	const now = isPostgres ? sql`now()` : sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
	const rows = await db
		.insert(s.keyedLock)
		.values({ key, expiresAt })
		.onConflictDoUpdate({
			target: s.keyedLock.key,
			set: { expiresAt },
			setWhere: sql`${s.keyedLock.expiresAt} < ${now}`,
		})
		.returning({ key: s.keyedLock.key })
		.execute();
	return rows.length > 0;
};

export const releaseLock = async (key: string): Promise<void> => {
	await db.delete(s.keyedLock).where(eq(s.keyedLock.key, key)).execute();
};
