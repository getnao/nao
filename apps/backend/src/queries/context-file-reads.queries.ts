import { and, desc, eq, gte, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { isNotTestChat } from './chat.queries';

export interface ContextFileReads {
	/** The path as the agent wrote it, which may lack the leading slash. */
	filePath: string;
	readCount: number;
}

/** How often the agent read each file with its read tool since a date in users' chats, most read first. */
export async function getContextFileReads(projectId: string, since: Date, limit: number): Promise<ContextFileReads[]> {
	const filePath =
		dbConfig.dialect === Dialect.Postgres
			? sql<string>`${s.messagePart.toolInput}->>'file_path'`
			: sql<string>`json_extract(${s.messagePart.toolInput}, '$.file_path')`;
	const readCount = sql<number>`count(*)`;

	const rows = await db
		.select({ filePath, readCount })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(
			and(
				eq(s.chat.projectId, projectId),
				notInArray(s.chat.id, recommendationAnalysisChatIds(projectId)),
				isNotTestChat(),
				or(isNull(s.chatMessage.isForked), eq(s.chatMessage.isForked, false)),
				eq(s.messagePart.toolName, 'read'),
				eq(s.messagePart.toolState, 'output-available'),
				gte(s.messagePart.createdAt, since),
			),
		)
		.groupBy(filePath)
		.orderBy(desc(readCount))
		.limit(limit)
		.execute();

	return rows
		.filter((row): row is typeof row & { filePath: string } => Boolean(row.filePath))
		.map((row) => ({ filePath: row.filePath, readCount: Number(row.readCount) }));
}

function recommendationAnalysisChatIds(projectId: string) {
	return db
		.select({ id: s.contextRecommendationRun.chatId })
		.from(s.contextRecommendationRun)
		.where(and(eq(s.contextRecommendationRun.projectId, projectId), isNotNull(s.contextRecommendationRun.chatId)));
}
