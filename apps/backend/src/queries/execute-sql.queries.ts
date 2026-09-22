import { executeSemanticQuery, executeSql } from '@nao/shared/tools';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

export const EXECUTE_SQL_TOOL_NAME = 'execute_sql';
export const EXECUTE_SEMANTIC_QUERY_TOOL_NAME = 'execute_semantic_query';

/** Tools whose output is a query result addressable by `query_id` (charts, stories, read_query_result). */
export const QUERY_TOOL_NAMES = [EXECUTE_SQL_TOOL_NAME, EXECUTE_SEMANTIC_QUERY_TOOL_NAME] as const;
export type QueryToolName = (typeof QUERY_TOOL_NAMES)[number];

export function isQueryToolPart() {
	return inArray(s.messagePart.toolName, [...QUERY_TOOL_NAMES]);
}

type QueryPart = { toolInput: executeSql.Input; toolOutput: executeSql.Output };

/**
 * Reads a stored query part as plain SQL whichever tool produced it: a semantic query
 * resolves to the SQL the layer compiled, on the database the layer chose.
 */
function readQueryPart(toolName: string, toolInput: unknown, toolOutput: unknown): QueryPart {
	if (toolName === EXECUTE_SEMANTIC_QUERY_TOOL_NAME) {
		const input = executeSemanticQuery.InputSchema.parse(toolInput);
		const output = executeSemanticQuery.OutputSchema.parse(toolOutput);
		return {
			toolInput: { sql_query: output.compiled_sql, database_id: output.database_id, name: input.name },
			toolOutput: output,
		};
	}
	return {
		toolInput: executeSql.InputSchema.parse(toolInput),
		toolOutput: executeSql.OutputSchema.parse(toolOutput),
	};
}

function toQueryToolName(toolName: string): QueryToolName {
	return toolName === EXECUTE_SEMANTIC_QUERY_TOOL_NAME ? EXECUTE_SEMANTIC_QUERY_TOOL_NAME : EXECUTE_SQL_TOOL_NAME;
}

export function messagePartToolOutputIdEquals(queryId: string) {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.messagePart.toolOutput}->>'id' = ${queryId}`
		: sql`json_extract(${s.messagePart.toolOutput}, '$.id') = ${queryId}`;
}

function messagePartToolOutputIdIn(queryIds: Set<string>) {
	return or(...[...queryIds].map(messagePartToolOutputIdEquals));
}

export type LatestExecuteSqlRow = {
	projectId: string;
	userId: string;
	chatId: string;
	toolCallId: string;
	toolName: QueryToolName;
	toolInput: executeSql.Input;
	toolOutput: executeSql.Output;
	adminMode: boolean;
};

/** Latest non-superseded query part for a query id (global), read as SQL. */
export async function getLatestExecuteSqlByQueryId(queryId: string): Promise<LatestExecuteSqlRow | null> {
	const [row] = await db
		.select({
			projectId: s.chat.projectId,
			userId: s.chat.userId,
			chatId: s.chat.id,
			toolCallId: s.messagePart.toolCallId,
			toolName: s.messagePart.toolName,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
			messageSource: s.chatMessage.source,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(and(isQueryToolPart(), isNull(s.chatMessage.supersededAt), messagePartToolOutputIdEquals(queryId)))
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	if (!row?.toolCallId || !row.toolName || !row.toolInput || !row.toolOutput) {
		return null;
	}

	return {
		projectId: row.projectId,
		userId: row.userId,
		chatId: row.chatId,
		toolCallId: row.toolCallId,
		toolName: toQueryToolName(row.toolName),
		...readQueryPart(row.toolName, row.toolInput, row.toolOutput),
		adminMode: row.messageSource === 'admin',
	};
}

export async function getExecuteSqlOwnerByQueryId(
	queryId: string,
): Promise<{ projectId: string; userId: string; chatId: string; toolCallId: string } | null> {
	const row = await getLatestExecuteSqlByQueryId(queryId);
	if (!row) {
		return null;
	}
	return {
		projectId: row.projectId,
		userId: row.userId,
		chatId: row.chatId,
		toolCallId: row.toolCallId,
	};
}

/** Latest non-superseded query part for a query id within a chat, read as SQL. */
export async function getExecuteSqlPartByQueryIdInChat(
	chatId: string,
	queryId: string,
): Promise<{
	toolCallId: string;
	toolName: QueryToolName;
	toolInput: executeSql.Input;
	toolOutput: executeSql.Output;
	adminMode: boolean;
} | null> {
	const [row] = await db
		.select({
			toolCallId: s.messagePart.toolCallId,
			toolName: s.messagePart.toolName,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
			messageSource: s.chatMessage.source,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				isQueryToolPart(),
				messagePartToolOutputIdEquals(queryId),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	if (!row?.toolCallId || !row.toolName || !row.toolInput || !row.toolOutput) {
		return null;
	}

	return {
		toolCallId: row.toolCallId,
		toolName: toQueryToolName(row.toolName),
		...readQueryPart(row.toolName, row.toolInput, row.toolOutput),
		adminMode: row.messageSource === 'admin',
	};
}

export async function updateExecuteSqlPart(
	toolCallId: string,
	toolInput: executeSql.Input,
	toolOutput: executeSql.Output,
): Promise<void> {
	await takeFirstOrThrow(
		db
			.update(s.messagePart)
			.set({ toolInput, toolOutput })
			.where(and(eq(s.messagePart.toolCallId, toolCallId), eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME)))
			.returning({ toolCallId: s.messagePart.toolCallId })
			.execute(),
	);
}

async function loadLatestExecuteSqlParts(chatId: string, queryIds: Set<string>) {
	return db
		.select({
			toolName: s.messagePart.toolName,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
			messageSource: s.chatMessage.source,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				isQueryToolPart(),
				messagePartToolOutputIdIn(queryIds),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.createdAt), asc(s.messagePart.order))
		.execute();
}

/**
 * Load SQL templates for the given query ids from a chat.
 * When duplicates exist, the latest non-superseded part wins.
 */
export async function getLatestSqlQueriesByIds(
	chatId: string,
	queryIds: Set<string>,
): Promise<Record<string, { sqlQuery: string; databaseId?: string; adminMode: boolean }>> {
	if (queryIds.size === 0) {
		return {};
	}

	const parts = await loadLatestExecuteSqlParts(chatId, queryIds);
	const queries: Record<string, { sqlQuery: string; databaseId?: string; adminMode: boolean }> = {};
	for (const part of parts) {
		const output = part.toolOutput as { id?: string } | null;
		if (!output?.id || !queryIds.has(output.id) || !part.toolName) {
			continue;
		}
		const { sqlQuery, databaseId } = readStoredSql(part.toolName, part.toolInput, part.toolOutput);
		if (sqlQuery) {
			queries[output.id] = {
				sqlQuery,
				...(databaseId && { databaseId }),
				adminMode: part.messageSource === 'admin',
			};
		}
	}
	return queries;
}

/** Loose read of the SQL a stored part ran, tolerant of parts written by older versions. */
function readStoredSql(
	toolName: string,
	toolInput: unknown,
	toolOutput: unknown,
): { sqlQuery?: string; databaseId?: string } {
	if (toolName === EXECUTE_SEMANTIC_QUERY_TOOL_NAME) {
		const output = toolOutput as { compiled_sql?: string; database_id?: string } | null;
		return { sqlQuery: output?.compiled_sql, databaseId: output?.database_id };
	}
	const input = toolInput as { sql_query?: string; database_id?: string } | null;
	return { sqlQuery: input?.sql_query, databaseId: input?.database_id };
}

/**
 * Load cached query result rows for the given query ids from a chat.
 * When duplicates exist, the latest non-superseded part wins.
 */
export async function getLatestSqlQueryDataByIds(
	chatId: string,
	queryIds: Set<string>,
): Promise<Record<string, { data: unknown[]; columns: string[] }>> {
	if (queryIds.size === 0) {
		return {};
	}

	const parts = await loadLatestExecuteSqlParts(chatId, queryIds);
	const data: Record<string, { data: unknown[]; columns: string[] }> = {};
	for (const part of parts) {
		const output = part.toolOutput as { id?: string; data?: unknown[]; columns?: string[] } | null;
		if (output?.id && queryIds.has(output.id)) {
			data[output.id] = {
				data: output.data ?? [],
				columns: output.columns ?? [],
			};
		}
	}
	return data;
}
