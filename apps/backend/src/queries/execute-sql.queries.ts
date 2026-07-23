import { executeSql } from '@nao/shared/tools';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

export const EXECUTE_SQL_TOOL_NAME = 'execute_sql';

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
	toolInput: executeSql.Input;
	toolOutput: executeSql.Output;
	adminMode: boolean;
};

/** Latest non-superseded execute_sql part for a query id (global). */
export async function getLatestExecuteSqlByQueryId(queryId: string): Promise<LatestExecuteSqlRow | null> {
	const [row] = await db
		.select({
			projectId: s.chat.projectId,
			userId: s.chat.userId,
			chatId: s.chat.id,
			toolCallId: s.messagePart.toolCallId,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
			messageSource: s.chatMessage.source,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(
			and(
				eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME),
				isNull(s.chatMessage.supersededAt),
				messagePartToolOutputIdEquals(queryId),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	if (!row?.toolCallId || !row.toolInput || !row.toolOutput) {
		return null;
	}

	return {
		projectId: row.projectId,
		userId: row.userId,
		chatId: row.chatId,
		toolCallId: row.toolCallId,
		toolInput: executeSql.InputSchema.parse(row.toolInput),
		toolOutput: executeSql.OutputSchema.parse(row.toolOutput),
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

/** Latest non-superseded execute_sql part for a query id within a chat. */
export async function getExecuteSqlPartByQueryIdInChat(
	chatId: string,
	queryId: string,
): Promise<{ toolCallId: string; toolInput: executeSql.Input; toolOutput: executeSql.Output } | null> {
	const [row] = await db
		.select({
			toolCallId: s.messagePart.toolCallId,
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME),
				messagePartToolOutputIdEquals(queryId),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt), desc(s.messagePart.createdAt), desc(s.messagePart.order))
		.limit(1)
		.execute();

	if (!row?.toolCallId || !row.toolInput || !row.toolOutput) {
		return null;
	}

	return {
		toolCallId: row.toolCallId,
		toolInput: executeSql.InputSchema.parse(row.toolInput),
		toolOutput: executeSql.OutputSchema.parse(row.toolOutput),
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
			toolInput: s.messagePart.toolInput,
			toolOutput: s.messagePart.toolOutput,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME),
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
): Promise<Record<string, { sqlQuery: string; databaseId?: string }>> {
	if (queryIds.size === 0) {
		return {};
	}

	const parts = await loadLatestExecuteSqlParts(chatId, queryIds);
	const queries: Record<string, { sqlQuery: string; databaseId?: string }> = {};
	for (const part of parts) {
		const output = part.toolOutput as { id?: string } | null;
		const input = part.toolInput as { sql_query?: string; database_id?: string } | null;
		if (output?.id && queryIds.has(output.id) && input?.sql_query) {
			queries[output.id] = {
				sqlQuery: input.sql_query,
				...(input.database_id && { databaseId: input.database_id }),
			};
		}
	}
	return queries;
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
