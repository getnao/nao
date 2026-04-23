import type {
	ChatFilterType,
	ChatGroupBy,
	CitationData,
	GroupedChatListResponse,
	LlmProvider,
} from '@nao/shared/types';
import { and, asc, desc, eq, gte, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';

import s, {
	DBChat,
	DBChatMessage,
	DBMessagePart,
	MessageFeedback,
	NewChat,
	NewMessagePart,
} from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { ForkMetadata, StopReason, TokenUsage, UIChat, UIMessage, UIMessagePart } from '../types/chat';
import { applyChatFilters, buildChatGroups, type EnrichedChat, type SourcePlatform } from '../utils/chat-list';
import { convertDBPartToUIPart, mapUIPartsToDBParts } from '../utils/chat-message-part-mappings';
import { getErrorMessage } from '../utils/utils';

const chatCreatedAtMs =
	dbConfig.dialect === Dialect.Postgres
		? sql<number>`(extract(epoch from ${s.chat.createdAt}) * 1000)`
		: sql<number>`${s.chat.createdAt}`;

const chatUpdatedAtMs =
	dbConfig.dialect === Dialect.Postgres
		? sql<number>`(extract(epoch from ${s.chat.updatedAt}) * 1000)`
		: sql<number>`${s.chat.updatedAt}`;

const sqlFalse = dbConfig.dialect === Dialect.Postgres ? sql<boolean>`false` : sql<boolean>`0`;

const sourcePlatformExpr = sql<SourcePlatform>`case
	when ${s.chat.slackThreadId} is not null then 'Slack'
	when ${s.chat.teamsThreadId} is not null then 'Teams'
	when ${s.chat.whatsappThreadId} is not null then 'WhatsApp'
	when ${s.chat.telegramThreadId} is not null then 'Telegram'
	else 'Web'
end`;

export const listGroupedChats = async (
	userId: string,
	groupBy: ChatGroupBy,
	filters: ChatFilterType[],
): Promise<GroupedChatListResponse> => {
	const effective = filters.length === 0 || filters.includes('all') ? (['all'] as ChatFilterType[]) : filters;
	const needsShared = effective.includes('all') || effective.includes('shared_with_me') || groupBy === 'ownership';

	const [ownItems, sharedItems] = await Promise.all([
		listOwnChats(userId),
		needsShared ? listSharedWithMeChats(userId) : Promise.resolve([]),
	]);

	const allItems = [...ownItems, ...sharedItems];
	const filtered = applyChatFilters(allItems, effective);
	return { groups: buildChatGroups(filtered, groupBy) };
};

async function listOwnChats(userId: string): Promise<EnrichedChat[]> {
	const rows = await db
		.select({
			id: s.chat.id,
			title: s.chat.title,
			isStarred: s.chat.isStarred,
			createdAt: chatCreatedAtMs,
			updatedAt: chatUpdatedAtMs,
			kind: sql<'own'>`'own'`,
			projectId: s.chat.projectId,
			projectName: s.project.name,
			isSharedByMe: sql<boolean>`exists(select 1 from ${s.sharedChat} where ${s.sharedChat.chatId} = ${s.chat.id})`,
			ownerName: s.user.name,
			sourcePlatform: sourcePlatformExpr,
		})
		.from(s.chat)
		.innerJoin(s.project, eq(s.project.id, s.chat.projectId))
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.where(and(eq(s.chat.userId, userId), isNull(s.chat.deletedAt)))
		.orderBy(desc(s.chat.updatedAt))
		.execute();
	return rows satisfies EnrichedChat[];
}

async function listSharedWithMeChats(userId: string): Promise<EnrichedChat[]> {
	const rows = await db
		.select({
			id: s.sharedChat.chatId,
			title: s.chat.title,
			isStarred: sqlFalse,
			createdAt: chatCreatedAtMs,
			updatedAt: chatUpdatedAtMs,
			kind: sql<'shared'>`'shared'`,
			shareId: s.sharedChat.id,
			projectId: s.chat.projectId,
			projectName: s.project.name,
			isSharedByMe: sqlFalse,
			ownerName: s.user.name,
			sourcePlatform: sourcePlatformExpr,
		})
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.innerJoin(s.project, eq(s.project.id, s.chat.projectId))
		.innerJoin(s.user, eq(s.user.id, s.chat.userId))
		.leftJoin(
			s.sharedChatAccess,
			and(eq(s.sharedChatAccess.sharedChatId, s.sharedChat.id), eq(s.sharedChatAccess.userId, userId)),
		)
		.where(
			and(
				isNull(s.chat.deletedAt),
				ne(s.chat.userId, userId),
				or(
					and(
						eq(s.sharedChat.visibility, 'project'),
						or(
							sql`exists(select 1 from ${s.projectMember} where ${s.projectMember.projectId} = ${s.chat.projectId} and ${s.projectMember.userId} = ${userId})`,
							sql`exists(select 1 from ${s.orgMember} where ${s.orgMember.orgId} = ${s.project.orgId} and ${s.orgMember.userId} = ${userId})`,
						),
					),
					and(eq(s.sharedChat.visibility, 'specific'), isNotNull(s.sharedChatAccess.userId)),
				),
			),
		)
		.orderBy(desc(s.chat.updatedAt))
		.execute();
	return rows satisfies EnrichedChat[];
}

/** Return the chat with its messages as well as the user id for ownership check. */
export const getChat = async (
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
		.where(and(eq(s.chatMessage.chatId, chatId), isNull(s.chatMessage.supersededAt), isNull(s.chat.deletedAt)))
		.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.order))
		.$dynamic();

	const result = opts.includeFeedback
		? await query.leftJoin(s.messageFeedback, eq(s.messageFeedback.messageId, s.chatMessage.id)).execute()
		: await query.execute();

	const chat = result.at(0)?.chat;
	if (!chat) {
		return [];
	}

	const messages = aggregateChatMessagParts(result);
	return [
		{
			id: chatId,
			projectId: chat.projectId,
			title: chat.title,
			isStarred: chat.isStarred,
			createdAt: chat.createdAt.getTime(),
			updatedAt: chat.updatedAt.getTime(),
			messages,
			forkMetadata: chat.forkMetadata ?? undefined,
		},
		chat.userId,
	];
};

/** Aggregate the message parts into a list of UI messages. */
const aggregateChatMessagParts = (
	result: {
		chat_message: DBChatMessage;
		message_part: DBMessagePart;
		message_feedback?: MessageFeedback | null;
	}[],
): UIMessage[] => {
	const messagesMap = result.reduce(
		(acc, row) => {
			const uiPart = convertDBPartToUIPart(row.message_part);
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
					source: row.chat_message.source ?? undefined,
					isForked: row.chat_message.isForked ?? undefined,
					citation: row.chat_message.citation ?? undefined,
				};
			}
			return acc;
		},
		{} as Record<string, UIMessage>,
	);

	return Object.values(messagesMap);
};

export const getChatMessages = async (chatId: string): Promise<UIMessage[]> => {
	const result = await db
		.select()
		.from(s.chatMessage)
		.where(and(eq(s.chatMessage.chatId, chatId), isNull(s.chatMessage.supersededAt)))
		.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
		.orderBy(asc(s.chatMessage.createdAt), asc(s.messagePart.order))
		.execute();

	return aggregateChatMessagParts(result);
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

/** Marks all messages from a given message id onwards as superseeded (won't be used in the conversation anymore). */
export const supersedeMessagesFrom = async (chatId: string, fromMessageId: string): Promise<void> => {
	await db.transaction(async (t) => {
		const [fromMessage] = await t
			.select({ createdAt: s.chatMessage.createdAt })
			.from(s.chatMessage)
			.where(and(eq(s.chatMessage.id, fromMessageId), eq(s.chatMessage.chatId, chatId)))
			.execute();

		if (!fromMessage) {
			return;
		}

		await t
			.update(s.chatMessage)
			.set({ supersededAt: new Date() })
			.where(
				and(
					eq(s.chatMessage.chatId, chatId),
					gte(s.chatMessage.createdAt, fromMessage.createdAt),
					isNull(s.chatMessage.supersededAt),
				),
			)
			.execute();
	});
};

export const createChat = async (
	newChat: NewChat,
	newUserMessage: {
		text: string;
		source?: 'slack' | 'teams' | 'telegram' | 'whatsapp' | 'web';
		citation?: CitationData;
	},
	additionalParts: UIMessagePart[] = [],
): Promise<[DBChat, DBChatMessage]> => {
	return db.transaction(async (t): Promise<[DBChat, DBChatMessage]> => {
		const [savedChat] = await t.insert(s.chat).values(newChat).returning().execute();

		const [savedMessage] = await t
			.insert(s.chatMessage)
			.values({
				chatId: savedChat.id,
				role: 'user',
				source: newUserMessage.source,
				citation: newUserMessage.citation ?? null,
			})
			.returning()
			.execute();

		const parts: UIMessagePart[] = [{ type: 'text', text: newUserMessage.text }, ...additionalParts];
		const dbParts = mapUIPartsToDBParts(parts, savedMessage.id);
		await t.insert(s.messagePart).values(dbParts).execute();

		return [savedChat, savedMessage];
	});
};

export const createForkedChat = async (newChat: NewChat, messages: Array<Omit<UIMessage, 'id'>>): Promise<DBChat> => {
	return db.transaction(async (t) => {
		const [savedChat] = await t.insert(s.chat).values(newChat).returning().execute();

		const baseTime = Date.now();
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			const messageId = crypto.randomUUID();
			await t
				.insert(s.chatMessage)
				.values({
					id: messageId,
					chatId: savedChat.id,
					role: message.role,
					isForked: true,
					createdAt: new Date(baseTime + i),
				})
				.execute();

			const dbParts = remapToolCallIds(mapUIPartsToDBParts(message.parts, messageId));
			if (dbParts.length > 0) {
				await t.insert(s.messagePart).values(dbParts).execute();
			}
		}

		return savedChat;
	});
};

/** Assigns fresh tool call IDs so forked parts don't collide with the source chat's unique constraint. */
const remapToolCallIds = (parts: NewMessagePart[]): NewMessagePart[] => {
	const idMap = new Map<string, string>();
	return parts.map((part) => {
		if (!part.toolCallId) {
			return part;
		}
		if (!idMap.has(part.toolCallId)) {
			idMap.set(part.toolCallId, crypto.randomUUID());
		}
		return { ...part, toolCallId: idMap.get(part.toolCallId) };
	});
};

export const upsertMessage = async (
	message: Omit<UIMessage, 'id'> & {
		id?: string;
		chatId: string;
		stopReason?: StopReason;
		error?: unknown;
		tokenUsage?: TokenUsage;
		llmProvider?: LlmProvider;
		llmModelId?: string;
	},
): Promise<{ messageId: string }> => {
	return db.transaction(async (t) => {
		const messageId = message.id ?? crypto.randomUUID();
		await t
			.insert(s.chatMessage)
			.values({
				id: messageId,
				chatId: message.chatId,
				role: message.role,
				stopReason: message.stopReason,
				errorMessage: getErrorMessage(message.error),
				llmProvider: message.llmProvider,
				llmModelId: message.llmModelId,
				source: message.source,
				isForked: message.isForked,
				citation: message.citation ?? null,
				...message.tokenUsage,
			})
			.onConflictDoNothing({ target: s.chatMessage.id })
			.execute();

		await t.delete(s.messagePart).where(eq(s.messagePart.messageId, messageId)).execute();
		const dbParts = mapUIPartsToDBParts(message.parts, messageId);
		if (dbParts.length) {
			await t.insert(s.messagePart).values(dbParts).execute();
		}

		await t.update(s.chat).set({ updatedAt: new Date() }).where(eq(s.chat.id, message.chatId)).execute();

		return { messageId };
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

export const softDeleteNonStarredChats = async (userId: string): Promise<{ count: number }> => {
	const result = await db
		.update(s.chat)
		.set({ deletedAt: new Date() })
		.where(and(eq(s.chat.userId, userId), eq(s.chat.isStarred, false), isNull(s.chat.deletedAt)))
		.returning({ id: s.chat.id })
		.execute();
	return { count: result.length };
};

export const toggleStarred = async (chatId: string, isStarred: boolean): Promise<void> => {
	await db.update(s.chat).set({ isStarred }).where(eq(s.chat.id, chatId)).execute();
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

export const getLastAssistantMessageId = async (chatId: string): Promise<string | null> => {
	const [result] = await db
		.select({ id: s.chatMessage.id })
		.from(s.chatMessage)
		.where(
			and(
				eq(s.chatMessage.chatId, chatId),
				isNull(s.chatMessage.supersededAt),
				eq(s.chatMessage.role, 'assistant'),
			),
		)
		.orderBy(desc(s.chatMessage.createdAt))
		.limit(1)
		.execute();
	return result?.id ?? null;
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

export const getChatByTeamsThread = async (threadId: string): Promise<{ id: string; title: string } | null> => {
	const result = await db
		.select({ id: s.chat.id, title: s.chat.title })
		.from(s.chat)
		.where(eq(s.chat.teamsThreadId, threadId))
		.limit(1)
		.execute();
	return result.at(0) || null;
};

export const getChatByTelegramThread = async (threadId: string): Promise<{ id: string; title: string } | null> => {
	const result = await db
		.select({ id: s.chat.id, title: s.chat.title })
		.from(s.chat)
		.where(eq(s.chat.telegramThreadId, threadId))
		.limit(1)
		.execute();
	return result.at(0) || null;
};

export const getChatByWhatsappThread = async (threadId: string): Promise<{ id: string; title: string } | null> => {
	const result = await db
		.select({ id: s.chat.id, title: s.chat.title })
		.from(s.chat)
		.where(eq(s.chat.whatsappThreadId, threadId))
		.limit(1)
		.execute();
	return result.at(0) || null;
};

export const clearWhatsappThread = async (threadId: string): Promise<boolean> => {
	const result = await db
		.update(s.chat)
		.set({ whatsappThreadId: null })
		.where(eq(s.chat.whatsappThreadId, threadId))
		.returning({ id: s.chat.id })
		.execute();
	return result.length > 0;
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
		.where(
			and(eq(s.chat.userId, userId), isNull(s.chat.deletedAt), caseInsensitiveLike(s.chat.title, searchPattern)),
		)
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
		.where(
			and(
				eq(s.chat.userId, userId),
				isNull(s.chat.deletedAt),
				caseInsensitiveLike(s.messagePart.text, searchPattern),
			),
		)
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

export const getSelectionForksByShareId = async (
	userId: string,
	shareId: string,
	forkType: 'chat_selection' | 'story_selection',
): Promise<{ chatId: string; selectionStart: number; selectionEnd: number; selectionText: string }[]> => {
	const typeFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.chat.forkMetadata}->>'type' = ${forkType}`
			: sql`json_extract(${s.chat.forkMetadata}, '$.type') = ${forkType}`;

	const idFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.chat.forkMetadata}->>'id' = ${shareId}`
			: sql`json_extract(${s.chat.forkMetadata}, '$.id') = ${shareId}`;

	const results = await db
		.select({ id: s.chat.id, forkMetadata: s.chat.forkMetadata })
		.from(s.chat)
		.where(and(eq(s.chat.userId, userId), isNull(s.chat.deletedAt), typeFilter, idFilter))
		.execute();

	return results
		.filter((r) => r.forkMetadata?.selectionStart !== undefined)
		.map((r) => {
			const meta = r.forkMetadata!;
			return {
				chatId: r.id,
				selectionStart: meta.selectionStart!,
				selectionEnd: meta.selectionEnd!,
				selectionText: meta.selectionText ?? '',
			};
		});
};

export const getForkMetadata = async (chatId: string): Promise<ForkMetadata | null> => {
	const [result] = await db
		.select({ forkMetadata: s.chat.forkMetadata })
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.execute();
	return result?.forkMetadata ?? null;
};

export const getChatProjectId = async (chatId: string): Promise<string | undefined> => {
	const [result] = await db
		.select({ projectId: s.chat.projectId })
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.execute();
	return result?.projectId;
};

export const getProjectIdByQueryId = async (queryId: string): Promise<string | undefined> => {
	const jsonIdFilter =
		dbConfig.dialect === Dialect.Postgres
			? sql`${s.messagePart.toolOutput}->>'id' = ${queryId}`
			: sql`json_extract(${s.messagePart.toolOutput}, '$.id') = ${queryId}`;

	const [result] = await db
		.select({ projectId: s.chat.projectId })
		.from(s.messagePart)
		.innerJoin(s.chatMessage, eq(s.messagePart.messageId, s.chatMessage.id))
		.innerJoin(s.chat, eq(s.chatMessage.chatId, s.chat.id))
		.where(jsonIdFilter)
		.execute();

	return result?.projectId;
};

export async function getChatInfo(
	chatId: string,
): Promise<{ projectId: string; userId: string; title: string } | null> {
	const [row] = await db
		.select({ projectId: s.chat.projectId, userId: s.chat.userId, title: s.chat.title })
		.from(s.chat)
		.where(eq(s.chat.id, chatId))
		.execute();
	return row ?? null;
}
