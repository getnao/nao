import { and, desc, eq, isNull, lt, or, SQL, sql } from 'drizzle-orm';

import s, { NewLog } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { LogFilter } from '../types/log';

export const insertLog = async (record: NewLog): Promise<void> => {
	await db.insert(s.log).values(record).execute();
};

export const getLogs = async (projectId: string, filter: LogFilter) => {
	const conditions: SQL[] = [or(eq(s.log.projectId, projectId), isNull(s.log.projectId))!];

	if (filter.level) {
		conditions.push(eq(s.log.level, filter.level));
	}
	if (filter.source) {
		conditions.push(eq(s.log.source, filter.source));
	}

	return db
		.select()
		.from(s.log)
		.where(and(...conditions))
		.orderBy(desc(s.log.createdAt))
		.limit(filter.limit)
		.execute();
};

export const deleteOldLogs = async (retentionDays: number): Promise<void> => {
	const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
	const cutoff =
		dbConfig.dialect === Dialect.Postgres
			? sql`now() - make_interval(secs => ${retentionMs / 1000})`
			: sql`(cast(unixepoch('subsecond') * 1000 as integer)) - ${retentionMs}`;

	await db.delete(s.log).where(lt(s.log.createdAt, cutoff)).execute();
};
