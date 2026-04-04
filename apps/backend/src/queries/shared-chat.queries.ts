import { and, desc, eq, inArray } from 'drizzle-orm';

import s, { type DBSharedChat } from '../db/abstractSchema';
import { db } from '../db/db';
import { type ForkMetadata } from '../types/chat';

export type SharedChatWithDetails = DBSharedChat & {
	authorName: string;
	title: string;
	userId: string;
	projectId: string;
	forkMetadata?: ForkMetadata;
};

export async function listProjectSharedChats(projectId: string, userId: string): Promise<SharedChatWithDetails[]> {
	const allChats = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.chat.projectId,
			userId: s.chat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			authorName: s.user.name,
			title: s.chat.title,
		})
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.where(eq(s.chat.projectId, projectId))
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
		.where(and(eq(s.sharedChatAccess.userId, userId), inArray(s.sharedChatAccess.sharedChatId, specificChatIds)))
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

export async function createSharedChat(
	chat: Pick<DBSharedChat, 'chatId' | 'visibility'>,
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

export async function canUserAccessSharedChat(shareId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ sharedChatId: s.sharedChatAccess.sharedChatId })
		.from(s.sharedChatAccess)
		.where(and(eq(s.sharedChatAccess.sharedChatId, shareId), eq(s.sharedChatAccess.userId, userId)))
		.execute();
	return !!row;
}

export async function getSharedChatInfo(id: string): Promise<SharedChatWithDetails | null> {
	const [row] = await db
		.select({
			id: s.sharedChat.id,
			projectId: s.chat.projectId,
			userId: s.chat.userId,
			chatId: s.sharedChat.chatId,
			visibility: s.sharedChat.visibility,
			createdAt: s.sharedChat.createdAt,
			authorName: s.user.name,
			title: s.chat.title,
			forkMetadata: s.chat.forkMetadata,
		})
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.innerJoin(s.user, eq(s.chat.userId, s.user.id))
		.where(eq(s.sharedChat.id, id))
		.execute();

	return row ? { ...row, forkMetadata: row.forkMetadata ?? undefined } : null;
}

export async function getShareIdByChatId(
	chatId: string,
	userId: string,
): Promise<{ id: string; visibility: string } | null> {
	const [row] = await db
		.select({ id: s.sharedChat.id, visibility: s.sharedChat.visibility })
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(and(eq(s.sharedChat.chatId, chatId), eq(s.chat.userId, userId)))
		.orderBy(desc(s.sharedChat.createdAt))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getShareAllowedUserIds(shareId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: s.sharedChatAccess.userId })
		.from(s.sharedChatAccess)
		.where(eq(s.sharedChatAccess.sharedChatId, shareId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function updateAllowedUsers(shareId: string, userIds: string[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(s.sharedChatAccess).where(eq(s.sharedChatAccess.sharedChatId, shareId)).execute();
		if (userIds.length > 0) {
			const rows = userIds.map((userId) => ({ sharedChatId: shareId, userId }));
			await tx.insert(s.sharedChatAccess).values(rows).execute();
		}
	});
}

export async function deleteSharedChat(id: string): Promise<void> {
	await db.delete(s.sharedChat).where(eq(s.sharedChat.id, id)).execute();
}
