import { and, desc, eq } from 'drizzle-orm';

import s, { type ChatVisibility, type DBSharedChat } from '../db/abstractSchema';
import { db } from '../db/db';

export type SharedChat = DBSharedChat & {
	title: string;
	chatCreatedAt: Date;
	chatUpdatedAt: Date;
};

export async function createSharedChat(
	chat: Pick<DBSharedChat, 'projectId' | 'userId' | 'chatId' | 'visibility'>,
	allowedUserIds?: string[],
): Promise<DBSharedChat> {
	const [created] = await db.insert(s.sharedChat).values(chat).returning().execute();

	if (chat.visibility === 'specific' && allowedUserIds && allowedUserIds.length > 0) {
		const accessRows = allowedUserIds.map((userId) => ({
			sharedChatId: created.id,
			userId,
		}));
		await db.insert(s.sharedChatAccess).values(accessRows).execute();
	}

	return created;
}

export async function getSharedChat(id: string): Promise<SharedChat | null> {
	const [row] = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.sharedChat.projectId,
			userId: s.sharedChat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			title: s.chat.title,
			chatCreatedAt: s.chat.createdAt,
			chatUpdatedAt: s.chat.updatedAt,
		})
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(eq(s.sharedChat.id, id))
		.execute();

	return row ?? null;
}

export async function findByChat(chatId: string, userId: string): Promise<{ id: string; visibility: ChatVisibility } | null> {
	const [row] = await db
		.select({ id: s.sharedChat.id, visibility: s.sharedChat.visibility })
		.from(s.sharedChat)
		.where(and(eq(s.sharedChat.chatId, chatId), eq(s.sharedChat.userId, userId)))
		.orderBy(desc(s.sharedChat.createdAt))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getSharedChatAllowedUserIds(sharedChatId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: s.sharedChatAccess.userId })
		.from(s.sharedChatAccess)
		.where(eq(s.sharedChatAccess.sharedChatId, sharedChatId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function updateAllowedUsers(sharedChatId: string, userIds: string[]): Promise<void> {
	await db.delete(s.sharedChatAccess).where(eq(s.sharedChatAccess.sharedChatId, sharedChatId)).execute();

	if (userIds.length > 0) {
		const rows = userIds.map((userId) => ({ sharedChatId, userId }));
		await db.insert(s.sharedChatAccess).values(rows).execute();
	}
}

export async function deleteSharedChat(id: string): Promise<void> {
	await db.delete(s.sharedChat).where(eq(s.sharedChat.id, id)).execute();
}

export async function canUserAccessSharedChat(sharedChatId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ sharedChatId: s.sharedChatAccess.sharedChatId })
		.from(s.sharedChatAccess)
		.where(and(eq(s.sharedChatAccess.sharedChatId, sharedChatId), eq(s.sharedChatAccess.userId, userId)))
		.execute();
	return !!row;
}

export async function listProjectSharedChats(projectId: string, userId: string): Promise<SharedChat[]> {
	const allChats = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.sharedChat.projectId,
			userId: s.sharedChat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			title: s.chat.title,
			chatCreatedAt: s.chat.createdAt,
			chatUpdatedAt: s.chat.updatedAt,
		})
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(eq(s.sharedChat.projectId, projectId))
		.orderBy(desc(s.chat.updatedAt))
		.execute();

	const specificChatIds = allChats
		.filter((chat) => chat.visibility === 'specific' && chat.userId !== userId)
		.map((chat) => chat.id);

	if (specificChatIds.length === 0) {
		return allChats;
	}

	const accessRows = await db
		.select({ sharedChatId: s.sharedChatAccess.sharedChatId })
		.from(s.sharedChatAccess)
		.where(eq(s.sharedChatAccess.userId, userId))
		.execute();

	const accessibleIds = new Set(accessRows.map((r) => r.sharedChatId));

	return allChats.filter((chat) => {
		if (chat.visibility === 'project') {
			return true;
		}
		if (chat.userId === userId) {
			return true;
		}
		return accessibleIds.has(chat.id);
	});
}

export async function getReadableSharedChatByChatId(
	chatId: string,
	userId: string,
): Promise<{ shareId: string; visibility: ChatVisibility } | null> {
	const [share] = await db
		.select({
			id: s.sharedChat.id,
			visibility: s.sharedChat.visibility,
			userId: s.sharedChat.userId,
		})
		.from(s.sharedChat)
		.where(eq(s.sharedChat.chatId, chatId))
		.orderBy(desc(s.sharedChat.createdAt))
		.limit(1)
		.execute();

	if (!share) {
		return null;
	}
	if (share.userId === userId) {
		return { shareId: share.id, visibility: share.visibility };
	}
	if (share.visibility === 'project') {
		return { shareId: share.id, visibility: share.visibility };
	}

	const hasAccess = await canUserAccessSharedChat(share.id, userId);
	return hasAccess ? { shareId: share.id, visibility: share.visibility } : null;
}
