import { executeSemanticQuery, executeSql } from '@nao/shared/tools';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';
import { chunk } from '../utils/utils';

export const EXECUTE_SQL_TOOL_NAME = 'execute_sql';
export const EXECUTE_SEMANTIC_QUERY_TOOL_NAME = 'execute_semantic_query';

/** Tools whose output is a query result addressable by `query_id` (charts, stories, read_query_result). */
export const QUERY_TOOL_NAMES = [EXECUTE_SQL_TOOL_NAME, EXECUTE_SEMANTIC_QUERY_TOOL_NAME] as const;
export type QueryToolName = (typeof QUERY_TOOL_NAMES)[number];

const MAX_QUERY_IDS_PER_LOOKUP = 500;

export function isQueryToolPart() {
	return inArray(s.messagePart.toolName, [...QUERY_TOOL_NAMES]);
}

type QueryPart = { toolInput: executeSql.Input; toolOutput: executeSql.Output };

export type StoredSqlQuery = { sqlQuery: string; databaseId?: string; dialect?: string; adminMode: boolean };

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

/** The stored output of one query part, as is: it is only read for its rows, so it is not parsed. */
export async function getQueryToolOutputInChat(chatId: string, toolCallId: string): Promise<executeSql.Output | null> {
	const [row] = await db
		.select({ toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(and(eq(s.chatMessage.chatId, chatId), eq(s.messagePart.toolCallId, toolCallId), isQueryToolPart()))
		.limit(1)
		.execute();

	return (row?.toolOutput as executeSql.Output | null | undefined) ?? null;
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

/** Same as `getLatestSqlQueryDataByIds` for several chats at once, in a single query. */
export async function getLatestSqlQueryDataByChats(
	queryIdsByChat: Map<string, Set<string>>,
): Promise<Map<string, Record<string, { data: unknown[]; columns: string[] }>>> {
	const allQueryIds = new Set([...queryIdsByChat.values()].flatMap((ids) => [...ids]));
	if (allQueryIds.size === 0) {
		return new Map();
	}
	const parts = await db
		.select({ chatId: s.chatMessage.chatId, toolOutput: s.messagePart.toolOutput })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				inArray(s.chatMessage.chatId, [...queryIdsByChat.keys()]),
				isNull(s.chatMessage.supersededAt),
				isQueryToolPart(),
				messagePartToolOutputIdIn(allQueryIds),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.createdAt), asc(s.messagePart.order))
		.execute();

	const dataByChat = new Map<string, Record<string, { data: unknown[]; columns: string[] }>>();
	for (const part of parts) {
		const output = part.toolOutput as { id?: string; data?: unknown[]; columns?: string[] } | null;
		if (!output?.id || !queryIdsByChat.get(part.chatId)?.has(output.id)) {
			continue;
		}
		const chatData = dataByChat.get(part.chatId) ?? {};
		chatData[output.id] = { data: output.data ?? [], columns: output.columns ?? [] };
		dataByChat.set(part.chatId, chatData);
	}
	return dataByChat;
}

async function loadLatestExecuteSqlParts(chatIds: string[], queryIds: Set<string>) {
	return db
		.select({
			chatId: s.chatMessage.chatId,
			toolName: s.messagePart.toolName,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
			messageSource: s.chatMessage.source,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				inArray(s.chatMessage.chatId, chatIds),
				isNull(s.chatMessage.supersededAt),
				isQueryToolPart(),
				messagePartToolOutputIdIn(queryIds),
			),
		)
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.createdAt), asc(s.messagePart.order))
		.execute();
}

export async function getLatestSqlQueriesByIds(
	chatId: string,
	queryIds: Set<string>,
): Promise<Record<string, StoredSqlQuery>> {
	const queriesByChat = await getLatestSqlQueriesByChats(new Map([[chatId, queryIds]]));
	return queriesByChat.get(chatId) ?? {};
}

/** Load SQL templates for the given query ids from several chats at once. */
export async function getLatestSqlQueriesByChats(
	queryIdsByChat: Map<string, Set<string>>,
): Promise<Map<string, Record<string, StoredSqlQuery>>> {
	const chatIds = [...queryIdsByChat.keys()];
	const allQueryIds = [...new Set([...queryIdsByChat.values()].flatMap((ids) => [...ids]))];
	const partBatches = await Promise.all(
		chunk(allQueryIds, MAX_QUERY_IDS_PER_LOOKUP).map((queryIds) =>
			loadLatestExecuteSqlParts(chatIds, new Set(queryIds)),
		),
	);

	const queriesByChat = new Map<string, Record<string, StoredSqlQuery>>();
	for (const part of partBatches.flat()) {
		const output = part.toolOutput as { id?: string; dialect?: string } | null;
		if (!output?.id || !queryIdsByChat.get(part.chatId)?.has(output.id) || !part.toolName) {
			continue;
		}
		const { sqlQuery, databaseId } = readStoredSql(part.toolName, part.toolInput, part.toolOutput);
		if (sqlQuery) {
			const chatQueries = queriesByChat.get(part.chatId) ?? {};
			chatQueries[output.id] = {
				sqlQuery,
				...(databaseId && { databaseId }),
				...(output.dialect && { dialect: output.dialect }),
				adminMode: part.messageSource === 'admin',
			};
			queriesByChat.set(part.chatId, chatQueries);
		}
	}
	return queriesByChat;
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

	const parts = await loadLatestExecuteSqlParts([chatId], queryIds);
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
