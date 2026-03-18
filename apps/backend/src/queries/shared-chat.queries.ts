import { and, desc, eq } from 'drizzle-orm';

import s, { type DBSharedChat } from '../db/abstractSchema';
import { db } from '../db/db';

export type SharedChatWithDetails = DBSharedChat & {
	authorName: string;
	title: string;
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

export async function getSharedChat(id: string): Promise<SharedChatWithDetails | null> {
	const [row] = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.sharedChat.projectId,
			userId: s.sharedChat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			authorName: s.user.name,
			title: s.chat.title,
		})
		.from(s.sharedChat)
		.innerJoin(s.user, eq(s.sharedChat.userId, s.user.id))
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(eq(s.sharedChat.id, id))
		.execute();

	return row ?? null;
}

export async function canUserAccessSharedChat(shareId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ sharedChatId: s.sharedChatAccess.sharedChatId })
		.from(s.sharedChatAccess)
		.where(and(eq(s.sharedChatAccess.sharedChatId, shareId), eq(s.sharedChatAccess.userId, userId)))
		.execute();
	return !!row;
}

export async function listProjectSharedChats(projectId: string, userId: string): Promise<SharedChatWithDetails[]> {
	const allChats = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.sharedChat.projectId,
			userId: s.sharedChat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			authorName: s.user.name,
			title: s.chat.title,
		})
		.from(s.sharedChat)
		.innerJoin(s.user, eq(s.sharedChat.userId, s.user.id))
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(eq(s.sharedChat.projectId, projectId))
		.orderBy(desc(s.sharedChat.createdAt))
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

export async function findByChat(chatId: string, userId: string): Promise<{ id: string; visibility: string } | null> {
	const [row] = await db
		.select({ id: s.sharedChat.id, visibility: s.sharedChat.visibility })
		.from(s.sharedChat)
		.where(and(eq(s.sharedChat.chatId, chatId), eq(s.sharedChat.userId, userId)))
		.orderBy(desc(s.sharedChat.createdAt))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getSharedChatAllowedUserIds(shareId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: s.sharedChatAccess.userId })
		.from(s.sharedChatAccess)
		.where(eq(s.sharedChatAccess.sharedChatId, shareId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function updateAllowedUsers(shareId: string, userIds: string[]): Promise<void> {
	await db.delete(s.sharedChatAccess).where(eq(s.sharedChatAccess.sharedChatId, shareId)).execute();

	if (userIds.length > 0) {
		const rows = userIds.map((userId) => ({ sharedChatId: shareId, userId }));
		await db.insert(s.sharedChatAccess).values(rows).execute();
	}
}

export async function deleteSharedChat(id: string): Promise<void> {
	await db.delete(s.sharedChat).where(eq(s.sharedChat.id, id)).execute();
}
