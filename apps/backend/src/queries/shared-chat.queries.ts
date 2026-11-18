import type { MessageBubble, Visibility } from '@nao/shared/types';
import { and, asc, countDistinct, desc, eq, inArray, isNull, type SQL, sql, type SQLWrapper } from 'drizzle-orm';

import s, { type DBSharedChat } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import { type ForkMetadata } from '../types/chat';
import { activeUserGroupCondition, activeUserGroupMembershipCondition } from './active-user-group.queries';
import { listLockedUserGroupIds, listLockedUserGroupIdsOfMember } from './locked-user-groups';
import { excludeLockedGroups } from './shared-story.queries';

export type SharedChatWithDetails = DBSharedChat & {
	authorName: string;
	title: string;
	userId: string;
	projectId: string;
	forkMetadata?: ForkMetadata;
	messageBubbles?: MessageBubble[];
};

/** Matches `shared_chat` rows granted to the user directly or through one of their active user groups. */
export function sharedChatGrantsUser(userId: string, lockedGroupIds: readonly string[]): SQL {
	return sql`(exists (
		select 1 from ${s.sharedChatAccess}
		where ${s.sharedChatAccess.sharedChatId} = ${s.sharedChat.id}
		  and ${s.sharedChatAccess.userId} = ${userId}
	) or (exists (
		select 1 from ${s.sharedChatGroupAccess}
		inner join ${s.userGroupMember} on ${s.userGroupMember.groupId} = ${s.sharedChatGroupAccess.groupId}
		inner join ${s.userGroup} on ${s.userGroup.id} = ${s.userGroupMember.groupId}
		where ${s.sharedChatGroupAccess.sharedChatId} = ${s.sharedChat.id}
		  and ${s.userGroupMember.userId} = ${userId}
		  and ${activeUserGroupMembershipCondition}
		  and ${activeUserGroupCondition}
		  and ${excludeLockedGroups(s.sharedChatGroupAccess.groupId, lockedGroupIds)}
	) and ${canEnterSharedChatProject(userId)}))`;
}

export async function listUserSharedChats(projectIds: string[], userId: string): Promise<SharedChatWithDetails[]> {
	if (projectIds.length === 0) {
		return [];
	}

	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);
	const chats = await db
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
		.where(
			and(
				inArray(s.chat.projectId, projectIds),
				sql`(${s.sharedChat.visibility} = 'project' OR ${s.chat.userId} = ${userId} OR ${sharedChatGrantsUser(userId, lockedGroupIds)})`,
			),
		)
		.orderBy(desc(s.sharedChat.createdAt))
		.execute();

	const bubblesMap = await fetchMessageBubbles(chats.map((c) => c.chatId));
	return chats.map((chat) => ({ ...chat, messageBubbles: bubblesMap.get(chat.chatId) }));
}

async function fetchMessageBubbles(chatIds: string[]): Promise<Map<string, MessageBubble[]>> {
	if (chatIds.length === 0) {
		return new Map();
	}

	const rows = await db
		.select({
			chatId: s.chatMessage.chatId,
			messageId: s.chatMessage.id,
			role: s.chatMessage.role,
			charCount: sql<number>`coalesce(sum(length(${s.messagePart.text})), 0)`.as('char_count'),
		})
		.from(s.chatMessage)
		.leftJoin(s.messagePart, and(eq(s.messagePart.messageId, s.chatMessage.id), eq(s.messagePart.type, 'text')))
		.where(
			and(
				inArray(s.chatMessage.chatId, chatIds),
				isNull(s.chatMessage.supersededAt),
				inArray(s.chatMessage.role, ['user', 'assistant']),
			),
		)
		.groupBy(s.chatMessage.id, s.chatMessage.chatId, s.chatMessage.role, s.chatMessage.createdAt)
		.orderBy(asc(s.chatMessage.createdAt))
		.execute();

	const map = new Map<string, MessageBubble[]>();
	for (const row of rows) {
		const bubbles = map.get(row.chatId) ?? [];
		bubbles.push({ role: row.role as 'user' | 'assistant', charCount: Number(row.charCount) });
		map.set(row.chatId, bubbles);
	}
	return map;
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
	const lockedGroupIds = await listLockedUserGroupIdsOfMember(userId);
	const [row] = await db
		.select({ id: s.sharedChat.id })
		.from(s.sharedChat)
		.where(and(eq(s.sharedChat.id, shareId), sharedChatGrantsUser(userId, lockedGroupIds)))
		.limit(1)
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

export async function getSharedChatVisibilityById(shareId: string): Promise<{ visibility: string } | null> {
	const [row] = await db
		.select({ visibility: s.sharedChat.visibility })
		.from(s.sharedChat)
		.where(eq(s.sharedChat.id, shareId))
		.limit(1)
		.execute();

	return row ?? null;
}

export async function getShareAllowedUserIds(shareId: string, executor: DBExecutor = db): Promise<string[]> {
	const rows = await executor
		.select({ userId: s.sharedChatAccess.userId })
		.from(s.sharedChatAccess)
		.where(eq(s.sharedChatAccess.sharedChatId, shareId))
		.execute();

	return rows.map((r) => r.userId);
}

export async function updateSharedChatAllowedUsers(shareId: string, userIds: string[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(s.sharedChatAccess).where(eq(s.sharedChatAccess.sharedChatId, shareId)).execute();
		if (userIds.length > 0) {
			const rows = userIds.map((userId) => ({ sharedChatId: shareId, userId }));
			await tx.insert(s.sharedChatAccess).values(rows).execute();
		}
	});
}

export type SharedChatUserGrant = { id: string; name: string; email: string };

export async function listSharedChatUserGrants(shareId: string): Promise<SharedChatUserGrant[]> {
	return db
		.select({ id: s.user.id, name: s.user.name, email: s.user.email })
		.from(s.sharedChatAccess)
		.innerJoin(s.user, eq(s.user.id, s.sharedChatAccess.userId))
		.where(eq(s.sharedChatAccess.sharedChatId, shareId))
		.orderBy(s.user.name)
		.execute();
}

export async function addSharedChatUsers(shareId: string, userIds: string[], executor: DBExecutor = db): Promise<void> {
	if (userIds.length === 0) {
		return;
	}
	await executor
		.insert(s.sharedChatAccess)
		.values(userIds.map((userId) => ({ sharedChatId: shareId, userId })))
		.onConflictDoNothing()
		.execute();
}

export async function removeSharedChatUsers(
	shareId: string,
	userIds: string[],
	executor: DBExecutor = db,
): Promise<void> {
	if (userIds.length === 0) {
		return;
	}
	await executor
		.delete(s.sharedChatAccess)
		.where(and(eq(s.sharedChatAccess.sharedChatId, shareId), inArray(s.sharedChatAccess.userId, userIds)))
		.execute();
}

/** Replaces the people and groups the share names, and its visibility, all at once. */
export async function replaceSharedChatAccess(
	shareId: string,
	access: { visibility: Visibility; userIds: string[]; groupIds: string[] },
): Promise<void> {
	await db.transaction(async (transaction) => {
		await updateSharedChatVisibility(shareId, access.visibility, transaction);
		const currentUserIds = await getShareAllowedUserIds(shareId, transaction);
		const currentGroupIds = await getShareAllowedGroupIds(shareId, transaction);
		await removeSharedChatUsers(
			shareId,
			currentUserIds.filter((id) => !access.userIds.includes(id)),
			transaction,
		);
		await removeSharedChatGroups(
			shareId,
			currentGroupIds.filter((id) => !access.groupIds.includes(id)),
			transaction,
		);
		await addSharedChatUsers(shareId, access.userIds, transaction);
		await addSharedChatGroups(shareId, access.groupIds, transaction);
	});
}

export async function updateSharedChatVisibility(
	shareId: string,
	visibility: Visibility,
	executor: DBExecutor = db,
): Promise<void> {
	await executor.update(s.sharedChat).set({ visibility }).where(eq(s.sharedChat.id, shareId)).execute();
}

export async function deleteSharedChat(id: string): Promise<void> {
	await db.delete(s.sharedChat).where(eq(s.sharedChat.id, id)).execute();
}

export async function listProjectWideSharedChatIds(projectId: string, ownerIds: string[]): Promise<string[]> {
	if (ownerIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({ id: s.sharedChat.id })
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.sharedChat.chatId, s.chat.id))
		.where(
			and(
				eq(s.chat.projectId, projectId),
				eq(s.sharedChat.visibility, 'project'),
				inArray(s.chat.userId, ownerIds),
			),
		)
		.execute();
	return rows.map((row) => row.id);
}

export async function deleteSharedChats(ids: string[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}
	await db.delete(s.sharedChat).where(inArray(s.sharedChat.id, ids)).execute();
}

export type SharedChatGroupGrant = { id: string; name: string; memberCount: number };

export async function listSharedChatGroupGrants(shareId: string): Promise<SharedChatGroupGrant[]> {
	const rows = await db
		.select({ id: s.userGroup.id, name: s.userGroup.name, memberCount: countDistinct(s.userGroupMember.userId) })
		.from(s.sharedChatGroupAccess)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.sharedChatGroupAccess.groupId))
		.leftJoin(
			s.userGroupMember,
			and(eq(s.userGroupMember.groupId, s.userGroup.id), activeUserGroupMembershipCondition),
		)
		.where(and(eq(s.sharedChatGroupAccess.sharedChatId, shareId), activeUserGroupCondition))
		.groupBy(s.userGroup.id, s.userGroup.name)
		.orderBy(s.userGroup.name)
		.execute();
	return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

export async function getShareAllowedGroupIds(shareId: string, executor: DBExecutor = db): Promise<string[]> {
	const rows = await executor
		.select({ groupId: s.sharedChatGroupAccess.groupId })
		.from(s.sharedChatGroupAccess)
		.where(eq(s.sharedChatGroupAccess.sharedChatId, shareId))
		.execute();
	return rows.map((row) => row.groupId);
}

/** Users granted directly plus the members of every active granted user group who still belong to the project. */
export async function getSharedChatRecipientUserIds(shareId: string): Promise<string[]> {
	const lockedGroupIds = await listLockedGroupIdsOfSharedChat(shareId);
	const [directUserIds, groupMembers] = await Promise.all([
		getShareAllowedUserIds(shareId),
		db
			.selectDistinct({ userId: s.userGroupMember.userId })
			.from(s.sharedChatGroupAccess)
			.innerJoin(s.sharedChat, eq(s.sharedChat.id, s.sharedChatGroupAccess.sharedChatId))
			.innerJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.sharedChatGroupAccess.groupId))
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupMember.groupId))
			.where(
				and(
					eq(s.sharedChatGroupAccess.sharedChatId, shareId),
					canEnterSharedChatProject(s.userGroupMember.userId),
					excludeLockedGroups(s.sharedChatGroupAccess.groupId, lockedGroupIds),
					activeUserGroupCondition,
					activeUserGroupMembershipCondition,
				),
			)
			.execute(),
	]);
	return [...new Set([...directUserIds, ...groupMembers.map((member) => member.userId)])];
}

export async function addSharedChatGroups(
	shareId: string,
	groupIds: string[],
	executor: DBExecutor = db,
): Promise<void> {
	if (groupIds.length === 0) {
		return;
	}
	await executor
		.insert(s.sharedChatGroupAccess)
		.values(groupIds.map((groupId) => ({ sharedChatId: shareId, groupId })))
		.onConflictDoNothing()
		.execute();
}

export async function removeSharedChatGroups(
	shareId: string,
	groupIds: string[],
	executor: DBExecutor = db,
): Promise<void> {
	if (groupIds.length === 0) {
		return;
	}
	await executor
		.delete(s.sharedChatGroupAccess)
		.where(
			and(eq(s.sharedChatGroupAccess.sharedChatId, shareId), inArray(s.sharedChatGroupAccess.groupId, groupIds)),
		)
		.execute();
}

/** Mirrors `listUsersWithProjectAccess`: a project member, or a member of the project's organization. */
function canEnterSharedChatProject(userId: string | SQLWrapper): SQL {
	return sql`exists (
		select 1 from ${s.chat}
		inner join ${s.project} on ${s.project.id} = ${s.chat.projectId}
		where ${s.chat.id} = ${s.sharedChat.chatId}
		  and (exists (
			select 1 from ${s.projectMember}
			where ${s.projectMember.projectId} = ${s.project.id}
			  and ${s.projectMember.userId} = ${userId}
		  ) or exists (
			select 1 from ${s.orgMember}
			where ${s.orgMember.orgId} = ${s.project.orgId}
			  and ${s.orgMember.userId} = ${userId}
		  ))
	)`;
}

async function listLockedGroupIdsOfSharedChat(shareId: string): Promise<string[]> {
	const [share] = await db
		.select({ projectId: s.chat.projectId })
		.from(s.sharedChat)
		.innerJoin(s.chat, eq(s.chat.id, s.sharedChat.chatId))
		.where(eq(s.sharedChat.id, shareId))
		.execute();
	return share ? listLockedUserGroupIds(share.projectId) : [];
}
