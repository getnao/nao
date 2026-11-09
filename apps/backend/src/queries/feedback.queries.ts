import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import s, { MessageFeedback, NewMessageFeedback, NewStoryFeedback, StoryFeedback } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { FeedbackWithDetails, RatedMessageContext } from '../types/message-feedback';

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

export const deleteFeedbackVote = async (messageId: string, vote: 'up' | 'down'): Promise<void> => {
	await db
		.delete(s.messageFeedback)
		.where(and(eq(s.messageFeedback.messageId, messageId), eq(s.messageFeedback.vote, vote)))
		.execute();
};

export const listRecentFeedbacks = async (projectId: string, limit = 10): Promise<FeedbackWithDetails[]> => {
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

export const upsertStoryFeedback = async (feedback: NewStoryFeedback): Promise<StoryFeedback> => {
	const [result] = await db
		.insert(s.storyFeedback)
		.values(feedback)
		.onConflictDoUpdate({
			target: [s.storyFeedback.storyId, s.storyFeedback.userId],
			set: {
				vote: feedback.vote,
				explanation: feedback.explanation ?? null,
				updatedAt: new Date(),
			},
		})
		.returning()
		.execute();
	return result;
};

export const getUserStoryFeedback = async (storyId: string, userId: string): Promise<StoryFeedback | null> => {
	const [result] = await db
		.select()
		.from(s.storyFeedback)
		.where(and(eq(s.storyFeedback.storyId, storyId), eq(s.storyFeedback.userId, userId)))
		.limit(1)
		.execute();
	return result ?? null;
};

/** Loads the rated assistant answer, its chat, and the user question that preceded it. */
export const getRatedMessageContext = async (messageId: string): Promise<RatedMessageContext | null> => {
	const [message] = await db
		.select({
			chatId: s.chat.id,
			chatTitle: s.chat.title,
			projectId: s.chat.projectId,
			chatOwnerId: s.chat.userId,
			createdAt: s.chatMessage.createdAt,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(eq(s.chatMessage.id, messageId))
		.execute();
	if (!message) {
		return null;
	}

	const [question] = await db
		.select({ id: s.chatMessage.id })
		.from(s.chatMessage)
		.where(
			and(
				eq(s.chatMessage.chatId, message.chatId),
				eq(s.chatMessage.role, 'user'),
				isNull(s.chatMessage.supersededAt),
				lt(s.chatMessage.createdAt, message.createdAt),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt))
		.limit(1)
		.execute();

	const { createdAt: _createdAt, ...chat } = message;
	return {
		...chat,
		question: question ? await getMessageText(question.id) : null,
		answer: await getMessageText(messageId),
	};
};

async function getMessageText(messageId: string): Promise<string | null> {
	const parts = await db
		.select({ text: s.messagePart.text })
		.from(s.messagePart)
		.where(and(eq(s.messagePart.messageId, messageId), eq(s.messagePart.type, 'text')))
		.orderBy(asc(s.messagePart.order))
		.execute();
	const text = parts
		.map((part) => part.text ?? '')
		.join('\n\n')
		.trim();
	return text || null;
}
