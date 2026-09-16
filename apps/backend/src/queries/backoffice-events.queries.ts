/* @license Enterprise */

import { and, count, desc, eq, isNotNull } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { LogPaginationInput, MessagePaginationInput, PaginatedResult } from '../types/backoffice';

export async function listProjectMessages(
	projectId: string,
	input: MessagePaginationInput,
): Promise<PaginatedResult<unknown>> {
	const filters = [
		eq(s.chat.projectId, projectId),
		input.errorsOnly ? isNotNull(s.chatMessage.errorMessage) : undefined,
		input.role ? eq(s.chatMessage.role, input.role) : undefined,
	].filter(isDefined);
	const where = and(...filters);
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.chatMessage.id,
				chatId: s.chat.id,
				chatTitle: s.chat.title,
				userId: s.user.id,
				userEmail: s.user.email,
				role: s.chatMessage.role,
				source: s.chatMessage.source,
				stopReason: s.chatMessage.stopReason,
				errorMessage: s.chatMessage.errorMessage,
				llmProvider: s.chatMessage.llmProvider,
				llmModelId: s.chatMessage.llmModelId,
				inputTotalTokens: s.chatMessage.inputTotalTokens,
				outputTotalTokens: s.chatMessage.outputTotalTokens,
				totalTokens: s.chatMessage.totalTokens,
				supersededAt: s.chatMessage.supersededAt,
				createdAt: s.chatMessage.createdAt,
			})
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.innerJoin(s.user, eq(s.user.id, s.chat.userId))
			.where(where)
			.orderBy(desc(s.chatMessage.createdAt))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db
			.select({ count: count() })
			.from(s.chatMessage)
			.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
			.where(where)
			.execute(),
	]);
	return { items, total: Number(totalRows[0]?.count ?? 0) };
}

export async function listProjectLogs(projectId: string, input: LogPaginationInput): Promise<PaginatedResult<unknown>> {
	const where = input.level
		? and(eq(s.log.projectId, projectId), eq(s.log.level, input.level))
		: eq(s.log.projectId, projectId);
	const [items, totalRows] = await Promise.all([
		db
			.select({
				id: s.log.id,
				level: s.log.level,
				source: s.log.source,
				message: s.log.message,
				createdAt: s.log.createdAt,
			})
			.from(s.log)
			.where(where)
			.orderBy(desc(s.log.createdAt))
			.limit(input.limit)
			.offset(input.offset)
			.execute(),
		db.select({ count: count() }).from(s.log).where(where).execute(),
	]);
	return { items, total: Number(totalRows[0]?.count ?? 0) };
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
