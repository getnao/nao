import { and, eq, inArray, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import type { StoredSqlQuery } from './execute-sql.queries';

export async function listStoryQueries(
	storyId: string,
	queryIds?: Iterable<string>,
	executor: DBExecutor = db,
): Promise<Record<string, StoredSqlQuery>> {
	const ids = queryIds ? [...queryIds] : undefined;
	if (ids?.length === 0) {
		return {};
	}

	const rows = await executor
		.select()
		.from(s.storyQuery)
		.where(and(eq(s.storyQuery.storyId, storyId), ids ? inArray(s.storyQuery.queryId, ids) : undefined))
		.execute();

	return Object.fromEntries(rows.map((row) => [row.queryId, toStoredSqlQuery(row)]));
}

export async function upsertStoryQueries(
	storyId: string,
	queries: Record<string, StoredSqlQuery>,
	executor: DBExecutor = db,
): Promise<void> {
	const rows = Object.entries(queries).map(([queryId, query]) => ({
		storyId,
		queryId,
		sqlQuery: query.sqlQuery,
		databaseId: query.databaseId ?? null,
		dialect: query.dialect ?? null,
		adminMode: query.adminMode,
		semanticQuery: query.semanticQuery ?? null,
	}));
	if (rows.length === 0) {
		return;
	}

	await executor
		.insert(s.storyQuery)
		.values(rows)
		.onConflictDoUpdate({
			target: [s.storyQuery.storyId, s.storyQuery.queryId],
			set: {
				sqlQuery: sql`excluded.sql_query`,
				databaseId: sql`excluded.database_id`,
				dialect: sql`excluded.dialect`,
				adminMode: sql`excluded.admin_mode`,
				semanticQuery: sql`excluded.semantic_query`,
				updatedAt: new Date(),
			},
		})
		.execute();
}

function toStoredSqlQuery(row: typeof s.storyQuery.$inferSelect): StoredSqlQuery {
	return {
		sqlQuery: row.sqlQuery,
		adminMode: row.adminMode,
		...(row.databaseId ? { databaseId: row.databaseId } : {}),
		...(row.dialect ? { dialect: row.dialect } : {}),
		...(row.semanticQuery ? { semanticQuery: row.semanticQuery } : {}),
	};
}
