import { and, eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { databaseNow, databaseTimeIn } from './database-time';

export const tryAcquireLock = async (key: string, owner: string, leaseMs: number): Promise<boolean> => {
	const expiresAt = databaseTimeIn(leaseMs);
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
		.set({ expiresAt: databaseTimeIn(leaseMs) })
		.where(
			and(eq(s.keyedLock.key, key), eq(s.keyedLock.owner, owner), sql`${s.keyedLock.expiresAt} > ${databaseNow}`),
		)
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

export const deleteExpiredLocks = async (): Promise<void> => {
	await db
		.delete(s.keyedLock)
		.where(sql`${s.keyedLock.expiresAt} < ${databaseNow}`)
		.execute();
};
