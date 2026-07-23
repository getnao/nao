import { executeSql } from '@nao/shared/tools';
import { and, eq, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { takeFirstOrThrow } from '../utils/queries';

const EXECUTE_SQL_TOOL_NAME = 'execute_sql';

function queryIdFilter(queryId: string) {
	return dbConfig.dialect === Dialect.Postgres
		? sql`${s.messagePart.toolOutput}->>'id' = ${queryId}`
		: sql`json_extract(${s.messagePart.toolOutput}, '$.id') = ${queryId}`;
}

export async function getExecuteSqlOwnerByQueryId(
	queryId: string,
): Promise<{ projectId: string; userId: string; chatId: string; toolCallId: string } | null> {
	const [row] = await db
		.select({
			projectId: s.chat.projectId,
			userId: s.chat.userId,
			chatId: s.chat.id,
			toolCallId: s.messagePart.toolCallId,
		})
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(and(eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME), queryIdFilter(queryId)))
		.execute();

	if (!row?.toolCallId) {
		return null;
	}

	return {
		projectId: row.projectId,
		userId: row.userId,
		chatId: row.chatId,
		toolCallId: row.toolCallId,
	};
}

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
				eq(s.messagePart.toolName, EXECUTE_SQL_TOOL_NAME),
				queryIdFilter(queryId),
			),
		)
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
