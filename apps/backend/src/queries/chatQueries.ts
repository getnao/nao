import { eq } from 'drizzle-orm';

import s, { NewChat } from '../db/abstractSchema';
import { db } from '../db/db';
import { ListChatResponse, UIChat, UIMessage } from '../types/chat';
import { convertDBPartToUIPart, mapDBPartsToUIParts, mapUIPartsToDBParts } from '../utils/chatMessagePartMappings';

export const listUserChats = async (userId: string): Promise<ListChatResponse> => {
	const chats = await db.select().from(s.chat).where(eq(s.chat.userId, userId)).execute();
	return {
		chats: chats.map((chat) => ({
			id: chat.id,
			title: chat.title,
			createdAt: chat.createdAt.getTime(),
			updatedAt: chat.updatedAt.getTime(),
		})),
	};
};

export const loadChat = async (chatId: string): Promise<UIChat> => {
	return db.transaction(async (t) => {
		const result = await t
			.select()
			.from(s.chat)
			.innerJoin(s.chatMessage, eq(s.chatMessage.chatId, s.chat.id))
			.where(eq(s.chatMessage.chatId, chatId))
			.innerJoin(s.messagePart, eq(s.messagePart.messageId, s.chatMessage.id))
			.execute();

		const chat = result.at(0)?.chat;
		if (!chat) {
			throw new Error(`Chat with id ${chatId} not found.`);
		}

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
					};
				}
				return acc;
			},
			{} as Record<string, UIMessage>,
		);

		const uiMessages: UIMessage[] = Object.values(messagesMap);
		return {
			id: chatId,
			title: chat.title,
			createdAt: chat.createdAt.getTime(),
			updatedAt: chat.updatedAt.getTime(),
			messages: uiMessages,
		};
	});
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
		const savedParts = await t.insert(s.messagePart).values(dbParts).returning().execute();

		return {
			id: savedChat.id,
			title: savedChat.title,
			createdAt: savedChat.createdAt.getTime(),
			updatedAt: savedChat.updatedAt.getTime(),
			messages: [
				{
					id: savedMessage.id,
					role: savedMessage.role,
					parts: mapDBPartsToUIParts(savedParts),
				},
			],
		};
	});
};

export const upsertMessage = async (chatId: string, message: UIMessage): Promise<void> => {
	await db.transaction(async (t) => {
		const [savedMessage] = await t
			.insert(s.chatMessage)
			.values({
				chatId,
				role: message.role,
			})
			.onConflictDoUpdate({
				target: s.chatMessage.id,
				set: { chatId }, // `set` requires at least one column
			})
			.returning()
			.execute();

		await t.delete(s.messagePart).where(eq(s.messagePart.messageId, savedMessage.id)).execute();
		if (message.parts.length) {
			const dbParts = mapUIPartsToDBParts(message.parts, savedMessage.id);
			await t.insert(s.messagePart).values(dbParts).execute();
		}
	});
};

export const deleteChat = async (chatId: string): Promise<void> => {
	await db.delete(s.chat).where(eq(s.chat.id, chatId)).execute();
};
