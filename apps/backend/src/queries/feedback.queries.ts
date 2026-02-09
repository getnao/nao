import { desc, eq, sql } from 'drizzle-orm';

import s, { MessageFeedback, NewMessageFeedback } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { FeedbackWithDetails } from '../types/message-feedback';

export type { FeedbackWithDetails };

export const upsertFeedback = async (feedback: NewMessageFeedback): Promise<MessageFeedback> => {
	const [result] = await db
		.insert(s.messageFeedback)
		.values(feedback)
		.onConflictDoUpdate({
			target: s.messageFeedback.messageId,
			set: {
				vote: feedback.vote,
				explanation: feedback.explanation,
			},
		})
		.returning()
		.execute();
	return result;
};

export const getRecentFeedbacks = async (projectId: string, limit = 10): Promise<FeedbackWithDetails[]> => {
	// Aggregate text parts per message to avoid row duplication from the join
	const aggregatedTextExpr =
		dbConfig.dialect === Dialect.Postgres
			? sql<string>`string_agg(${s.messagePart.text}, ' ' order by ${s.messagePart.order})`
			: sql<string>`group_concat(${s.messagePart.text}, ' ')`;

	const messageTexts = db
		.select({
			messageId: s.messagePart.messageId,
			text: aggregatedTextExpr.as('aggregated_text'),
		})
		.from(s.messagePart)
		.where(eq(s.messagePart.type, 'text'))
		.groupBy(s.messagePart.messageId)
		.as('message_texts');

	const rows = await db
		.select({
			messageId: s.messageFeedback.messageId,
			vote: s.messageFeedback.vote,
			explanation: s.messageFeedback.explanation,
			createdAt: s.messageFeedback.createdAt,
			userName: s.user.name,
			messageText: messageTexts.text,
		})
		.from(s.messageFeedback)
		.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messageFeedback.messageId))
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.leftJoin(messageTexts, eq(messageTexts.messageId, s.messageFeedback.messageId))
		.where(eq(s.chat.projectId, projectId))
		.orderBy(desc(s.messageFeedback.createdAt))
		.limit(limit)
		.execute();

	return rows;
};
