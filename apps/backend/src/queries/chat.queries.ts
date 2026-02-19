import { and, desc, eq, like, sql } from 'drizzle-orm';

import s, { DBChat, DBChatMessage, DBMessagePart, MessageFeedback, NewChat } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { ListChatResponse, StopReason, TokenUsage, UIChat, UIMessage } from '../types/chat';
import { LlmProvider } from '../types/llm';
import { convertDBPartToUIPart, mapUIPartsToDBParts } from '../utils/chat-message-part-mappings';
import { getErrorMessage } from '../utils/utils';
import * as llmConfigQueries from './project-llm-config.queries';

export const checkChatExists = async (chatId: string): Promise<boolean> => {
	const result = await db.select().from(s.chat).where(eq(s.chat.id, chatId)).execute();
	return result.length > 0;
};

export const listUserChats = async (userId: string): Promise<ListChatResponse> => {
	const chats = await db
		.select()
		.from(s.chat)
		.where(eq(s.chat.userId, userId))
		.orderBy(desc(s.chat.createdAt))
		.execute();
	return {
		chats: chats.map((chat) => ({
			id: chat.id,
			title: chat.title,
			createdAt: chat.createdAt.getTime(),
			updatedAt: chat.updatedAt.getTime(),
		})),
	};
};

/** Return the chat with its messages as well as the user id for ownership check. */
export const loadChat = async (
	chatId: string,
	opts: {
		includeFeedback?: boolean;
	} = {
		includeFeedback: false,
	},
): Promise<[UIChat, userId: string] | []> => {
	const query = db
		.select()
		.from(s.chat)
		.innerJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
		.where(eq(s.chatMessage.chatId, chatId))
		.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
		.$dynamic();

	const result = opts.includeFeedback
		? await query.leftJoin(s.messageFeedback, eq(s.messageFeedback.messageId, s.chatMessage.id)).execute()
		: await query.execute();

	const chat = result.at(0)?.chat;
	if (!chat) {
		return [];
	}

	const provider = await llmConfigQueries.getProjectModelProvider(chat.projectId);
	const messages = aggregateChatMessagParts(result, provider);
	return [
		{
			id: chatId,
			title: chat.title,
			createdAt: chat.createdAt.getTime(),
			updatedAt: chat.updatedAt.getTime(),
			messages,
		},
		chat.userId,
	];
};

/** Aggregate the message parts into a list of UI messages. */
const aggregateChatMessagParts = (
	result: {
		chat: DBChat;
		chat_message: DBChatMessage;
		message_part: DBMessagePart;
		message_feedback?: MessageFeedback | null;
	}[],
	provider?: LlmProvider,
) => {
	const messagesMap = result.reduce(
		(acc, row) => {
			const uiPart = convertDBPartToUIPart(row.message_part, provider);
			if (!uiPart) {
				return acc;
			}

			if (acc[row.chat_message.id]) {
				acc[row.chat_message.id].parts.push(uiPart);
			} else {
				acc[row.chat_message.id] = {
					id: row.chat_message.id,
					role: row.chat_message.role,
					parts: [uiPart],
					feedback: row.message_feedback ?? undefined,
				};
			}
			return acc;
		},
		{} as Record<string, UIMessage>,
	);

	return Object.values(messagesMap);
};

export const getChatOwnerId = async (chatId: string): Promise<string | undefined> => {
	const [result] = await db
		.select({
			userId: s.chat.userId,
		})
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.execute();
	return result?.userId;
};

export const createChat = async (newChat: NewChat, message: UIMessage): Promise<UIChat> => {
	return db.transaction(async (t): Promise<UIChat> => {
		const [savedChat] = await t.insert(s.chat).values(newChat).returning().execute();

		const [savedMessage] = await t
			.insert(s.chatMessage)
			.values({
				chatId: savedChat.id,
				role: message.role,
			})
			.returning()
			.execute();

		const dbParts = mapUIPartsToDBParts(message.parts, savedMessage.id);
		if (dbParts.length) {
			await t.insert(s.messagePart).values(dbParts).execute();
		}

		return {
			id: savedChat.id,
			title: savedChat.title,
			createdAt: savedChat.createdAt.getTime(),
			updatedAt: savedChat.updatedAt.getTime(),
			messages: [
				{
					id: savedMessage.id,
					role: savedMessage.role,
					parts: message.parts,
				},
			],
		};
	});
};

export const upsertMessage = async (
	message: UIMessage, // TODO: generate uuid instead of using the one from the client
	opts: {
		chatId: string;
		stopReason?: StopReason;
		error?: unknown;
		tokenUsage?: TokenUsage;
		llmProvider?: LlmProvider;
		llmModelId?: string;
	},
): Promise<void> => {
	await db.transaction(async (t) => {
		await t
			.insert(s.chatMessage)
			.values({
				chatId: opts.chatId,
				id: message.id,
				role: message.role,
				stopReason: opts.stopReason,
				errorMessage: getErrorMessage(opts.error),
				llmProvider: opts.llmProvider,
				llmModelId: opts.llmModelId,
				...opts.tokenUsage,
			})
			.onConflictDoNothing({ target: s.chatMessage.id })
			.execute();

		await t.delete(s.messagePart).where(eq(s.messagePart.messageId, message.id)).execute();
		if (message.parts.length) {
			const dbParts = mapUIPartsToDBParts(message.parts, message.id);
			await t.insert(s.messagePart).values(dbParts).execute();
		}
	});
};

export const deleteChat = async (chatId: string): Promise<{ projectId: string }> => {
	const [result] = await db
		.delete(s.chat)
		.where(eq(s.chat.id, chatId))
		.returning({ projectId: s.chat.projectId })
		.execute();
	return result;
};

export const renameChat = async (chatId: string, title: string): Promise<{ projectId: string }> => {
	const [result] = await db
		.update(s.chat)
		.set({ title })
		.where(eq(s.chat.id, chatId))
		.returning({ projectId: s.chat.projectId })
		.execute();
	return result;
};

export const getOwnerOfChatAndMessage = async (chatId: string, messageId: string): Promise<string | undefined> => {
	const [result] = await db
		.select({
			userId: s.chat.userId,
		})
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.innerJoin(s.chatMessage, and(eq(s.chat.id, s.chatMessage.chatId), eq(s.chatMessage.id, messageId)))
		.execute();

	return result?.userId;
};

export const getChatBySlackThread = async (threadId: string): Promise<{ id: string; title: string } | null> => {
	const result = await db
		.select({ id: s.chat.id, title: s.chat.title })
		.from(s.chat)
		.where(eq(s.chat.slackThreadId, threadId))
		.limit(1)
		.execute();
	return result.at(0) || null;
};

export type SearchChatResult = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	matchedText?: string;
};

export const searchUserChats = async (userId: string, query: string, limit = 10): Promise<SearchChatResult[]> => {
	const searchPattern = `%${query}%`;

	// Search in chat titles
	const titleMatches = await db
		.select({
			id: s.chat.id,
			title: s.chat.title,
			createdAt: s.chat.createdAt,
			updatedAt: s.chat.updatedAt,
		})
		.from(s.chat)
		.where(and(eq(s.chat.userId, userId), caseInsensitiveLike(s.chat.title, searchPattern)))
		.orderBy(desc(s.chat.updatedAt))
		.limit(limit)
		.execute();

	const titleMatchIds = new Set(titleMatches.map((m) => m.id));

	// Search in message content
	const contentMatches = await db
		.select({
			id: s.chat.id,
			title: s.chat.title,
			createdAt: s.chat.createdAt,
			updatedAt: s.chat.updatedAt,
			matchedText: s.messagePart.text,
		})
		.from(s.chat)
		.innerJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
		.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
		.where(and(eq(s.chat.userId, userId), caseInsensitiveLike(s.messagePart.text, searchPattern)))
		.orderBy(desc(s.chat.updatedAt))
		.limit(limit * 2) // Fetch more to account for duplicates
		.execute();

	// Combine results: title matches first, then content matches (deduplicated)
	const results: SearchChatResult[] = titleMatches.map((m) => ({
		id: m.id,
		title: m.title,
		createdAt: m.createdAt.getTime(),
		updatedAt: m.updatedAt.getTime(),
	}));

	const seenIds = new Set(titleMatchIds);
	for (const m of contentMatches) {
		if (!seenIds.has(m.id)) {
			seenIds.add(m.id);
			results.push({
				id: m.id,
				title: m.title,
				createdAt: m.createdAt.getTime(),
				updatedAt: m.updatedAt.getTime(),
				matchedText: m.matchedText ?? undefined,
			});
		}
	}

	return results.slice(0, limit);
};

const caseInsensitiveLike = (column: Parameters<typeof like>[0], pattern: string) => {
	if (dbConfig.dialect === Dialect.Postgres) {
		return sql`${column} ILIKE ${pattern}`;
	}
	// SQLite LIKE is case-insensitive by default for ASCII
	return like(column, pattern);
};

export const getChatProjectId = async (chatId: string): Promise<string | undefined> => {
	const [result] = await db
		.select({ projectId: s.chat.projectId })
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.execute();
	return result?.projectId;
};
