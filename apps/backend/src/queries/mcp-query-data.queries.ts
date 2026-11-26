import { MCP_QUERY_DATA_RETENTION_MS } from '@nao/shared';
import { executeSemanticQuery } from '@nao/shared/tools';
import { and, eq, gt, inArray } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { EXECUTE_SEMANTIC_QUERY_TOOL_NAME, QUERY_TOOL_NAMES, type StoredSqlQuery } from './execute-sql.queries';

export async function upsertMcpQueryData(
	queryId: string,
	callLogId: string,
	projectId: string,
	columns: string[],
	data: Record<string, unknown>[],
	options?: { sourceChatId?: string | null },
): Promise<void> {
	const expiresAt = new Date(Date.now() + MCP_QUERY_DATA_RETENTION_MS);
	const sourceChatId = options?.sourceChatId ?? null;
	await db
		.insert(s.mcpQueryData)
		.values({ queryId, callLogId, projectId, columns, data, expiresAt, sourceChatId })
		.onConflictDoUpdate({
			target: s.mcpQueryData.queryId,
			set: { callLogId, columns, data, expiresAt, sourceChatId },
		})
		.execute();
}

/** The SQL, or semantic query, of the given MCP query results, read from the logged call that produced each of them. */
export async function getMcpSqlQueriesByIds(
	queryIds: Iterable<string>,
	owner: { projectId: string; userId: string },
): Promise<Record<string, StoredSqlQuery>> {
	const ids = [...queryIds];
	if (ids.length === 0) {
		return {};
	}

	const rows = await db
		.select({ queryId: s.mcpQueryData.queryId, toolName: s.mcpCallLog.toolName, toolInput: s.mcpCallLog.toolInput })
		.from(s.mcpQueryData)
		.innerJoin(s.mcpCallLog, eq(s.mcpCallLog.id, s.mcpQueryData.callLogId))
		.where(
			and(
				inArray(s.mcpQueryData.queryId, ids),
				eq(s.mcpQueryData.projectId, owner.projectId),
				eq(s.mcpCallLog.userId, owner.userId),
				inArray(s.mcpCallLog.toolName, [...QUERY_TOOL_NAMES]),
			),
		)
		.execute();

	return Object.fromEntries(rows.flatMap((row) => toStoredSqlQuery(row.queryId, row.toolName, row.toolInput)));
}

export async function getMcpQueryData(
	queryId: string,
	projectId: string,
	options?: { userId?: string },
): Promise<{ columns: string[]; data: Record<string, unknown>[]; sourceChatId: string | null } | null> {
	const baseQuery = db
		.select({
			columns: s.mcpQueryData.columns,
			data: s.mcpQueryData.data,
			sourceChatId: s.mcpQueryData.sourceChatId,
		})
		.from(s.mcpQueryData)
		.$dynamic();

	const conditions = [
		eq(s.mcpQueryData.queryId, queryId),
		eq(s.mcpQueryData.projectId, projectId),
		gt(s.mcpQueryData.expiresAt, new Date()),
	];

	const query = options?.userId
		? baseQuery
				.innerJoin(s.mcpCallLog, eq(s.mcpCallLog.id, s.mcpQueryData.callLogId))
				.where(and(...conditions, eq(s.mcpCallLog.userId, options.userId)))
		: baseQuery.where(and(...conditions));

	const [row] = await query.execute();

	if (!row) {
		return null;
	}
	return {
		columns: row.columns as string[],
		data: row.data as Record<string, unknown>[],
		sourceChatId: row.sourceChatId ?? null,
	};
}

function toStoredSqlQuery(queryId: string, toolName: string, toolInput: unknown): [string, StoredSqlQuery][] {
	if (toolName === EXECUTE_SEMANTIC_QUERY_TOOL_NAME) {
		return toStoredSemanticQuery(queryId, toolInput);
	}
	const input = toolInput as { sql_query?: unknown; database_id?: unknown } | null;
	if (typeof input?.sql_query !== 'string' || !input.sql_query.trim()) {
		return [];
	}
	const databaseId = typeof input.database_id === 'string' ? { databaseId: input.database_id } : {};
	return [[queryId, { sqlQuery: input.sql_query, adminMode: false, ...databaseId }]];
}

/** The compiled SQL is not logged; a semantic query is compiled again from its definition whenever it runs. */
function toStoredSemanticQuery(queryId: string, toolInput: unknown): [string, StoredSqlQuery][] {
	const semanticQuery = executeSemanticQuery.SemanticQuerySchema.safeParse(toolInput);
	return semanticQuery.success
		? [[queryId, { sqlQuery: '', adminMode: false, semanticQuery: semanticQuery.data }]]
		: [];
}
