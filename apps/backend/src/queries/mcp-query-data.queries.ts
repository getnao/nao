import { MCP_QUERY_DATA_RETENTION_MS } from '@nao/shared';
import { and, eq, gt, inArray } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

type McpQueryDefinition = { sqlQuery: string; databaseId?: string };

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

export async function getMcpQueryDefinitions(
	queryIds: Set<string>,
	projectId: string,
	userId: string,
): Promise<Record<string, McpQueryDefinition>> {
	if (queryIds.size === 0) {
		return {};
	}

	const rows = await db
		.select({
			queryId: s.mcpQueryData.queryId,
			toolInput: s.mcpCallLog.toolInput,
		})
		.from(s.mcpQueryData)
		.innerJoin(s.mcpCallLog, eq(s.mcpCallLog.id, s.mcpQueryData.callLogId))
		.where(
			and(
				inArray(s.mcpQueryData.queryId, [...queryIds]),
				eq(s.mcpQueryData.projectId, projectId),
				gt(s.mcpQueryData.expiresAt, new Date()),
				eq(s.mcpCallLog.userId, userId),
				eq(s.mcpCallLog.toolName, 'execute_sql'),
			),
		)
		.execute();

	const definitions: Record<string, McpQueryDefinition> = {};
	for (const row of rows) {
		const input = row.toolInput as { sql_query?: unknown; database_id?: unknown } | null;
		if (typeof input?.sql_query !== 'string' || !input.sql_query.trim()) {
			continue;
		}
		definitions[row.queryId] = {
			sqlQuery: input.sql_query,
			...(typeof input.database_id === 'string' && input.database_id ? { databaseId: input.database_id } : {}),
		};
	}
	return definitions;
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
