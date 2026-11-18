import type { Visibility } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import { logActivity } from './activity';
import { notifySharedItem } from './notification.service';
import { assertCanShareToProject, assertCanShareWith } from './project-sharing.service';
import { assertShareableUserGroupIds } from './shareable-user-groups.service';
import type { ShareActor } from './story-share-settings.service';

type SharedChatOwner = { id: string; name: string; email: string };

export type ChatShareSettings = {
	chatId: string;
	shareId: string | null;
	canManage: boolean;
	visibility: Visibility;
	owner: SharedChatOwner | null;
	users: sharedChatQueries.SharedChatUserGrant[];
	groups: sharedChatQueries.SharedChatGroupGrant[];
};

export type ChatShareChange = { visibility: Visibility; userIds: string[]; groupIds: string[]; notify: boolean };

type ManagedChat = { id: string; userId: string; title: string };

type ChatRecipients = { userIds: string[]; groupIds: string[] };

export async function getChatShareSettings(chat: ManagedChat, actor: ShareActor): Promise<ChatShareSettings> {
	await assertCanSeeChatShare(chat, actor);
	const [share, members] = await Promise.all([
		sharedChatQueries.getShareIdByChatId(chat.id, chat.userId),
		projectQueries.listUsersWithProjectAccess(actor.projectId),
	]);
	const owner = members.find((member) => member.id === chat.userId);
	return {
		chatId: chat.id,
		shareId: share?.id ?? null,
		canManage: chat.userId === actor.id || actor.role === 'admin',
		visibility: (share?.visibility as Visibility | undefined) ?? 'specific',
		owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
		users: share ? await sharedChatQueries.listSharedChatUserGrants(share.id) : [],
		groups: share ? await sharedChatQueries.listSharedChatGroupGrants(share.id) : [],
	};
}

/** Replaces who can read the chat with the given state, sharing or unsharing it as needed; returns the share left. */
export async function saveChatShareSettings(
	chat: ManagedChat,
	actor: ShareActor,
	change: ChatShareChange,
): Promise<{ shareId: string | null }> {
	const userIds = await keepProjectMembers(
		actor.projectId,
		change.userIds.filter((id) => id !== chat.userId),
	);
	const recipients = { userIds, groupIds: [...new Set(change.groupIds)] };

	if (change.visibility === 'specific' && recipients.userIds.length === 0 && recipients.groupIds.length === 0) {
		await unshareIfShared(chat);
		return { shareId: null };
	}
	if (change.visibility === 'project') {
		await assertCanShareToProject(actor.projectId, actor.id);
	}
	const existingShare = await sharedChatQueries.getShareIdByChatId(chat.id, chat.userId);
	const newRecipients = await listNewRecipients(existingShare?.id ?? null, recipients);
	await assertShareableUserGroupIds(actor.projectId, newRecipients.groupIds);
	await assertCanShareWith(actor.projectId, actor.id, newRecipients);

	const share = existingShare ?? (await createChatShare(chat, actor));
	const previousRecipientIds = new Set(await sharedChatQueries.getSharedChatRecipientUserIds(share.id));
	await sharedChatQueries.replaceSharedChatAccess(share.id, { visibility: change.visibility, ...recipients });

	if (change.visibility === 'project') {
		if (share.visibility !== 'project') {
			notifyChatProject(chat, actor, share.id, change.notify);
		}
		return { shareId: share.id };
	}
	const recipientIds = await sharedChatQueries.getSharedChatRecipientUserIds(share.id);
	notifyChatRecipients(
		chat,
		actor,
		share.id,
		recipientIds.filter((id) => !previousRecipientIds.has(id) && id !== actor.id),
		change.notify,
	);
	return { shareId: share.id };
}

export function assertCanManageChatShare(chat: ManagedChat & { projectId: string }, actor: ShareActor): void {
	if (chat.projectId !== actor.projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
	}
	if (chat.userId !== actor.id && actor.role !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can change who has access.' });
	}
}

async function assertCanSeeChatShare(chat: ManagedChat, actor: ShareActor): Promise<void> {
	if (actor.role === 'admin' || (await chatQueries.canUserAccessChat(chat.id, actor.id))) {
		return;
	}
	throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
}

async function createChatShare(chat: ManagedChat, actor: ShareActor): Promise<{ id: string; visibility: string }> {
	const created = await sharedChatQueries.createSharedChat({ chatId: chat.id, visibility: 'specific' });
	await logActivity({
		projectId: actor.projectId,
		userId: actor.id,
		type: 'chat.shared',
		chatId: chat.id,
		sharedChatId: created.id,
	});
	return { id: created.id, visibility: 'specific' };
}

async function unshareIfShared(chat: ManagedChat): Promise<void> {
	const share = await sharedChatQueries.getShareIdByChatId(chat.id, chat.userId);
	if (share) {
		await sharedChatQueries.deleteSharedChat(share.id);
	}
}

/** Only the people and groups a save adds are checked: those already on the share keep their access. */
async function listNewRecipients(shareId: string | null, recipients: ChatRecipients): Promise<ChatRecipients> {
	if (!shareId) {
		return recipients;
	}
	const [currentUserIds, currentGroupIds] = await Promise.all([
		sharedChatQueries.getShareAllowedUserIds(shareId),
		sharedChatQueries.getShareAllowedGroupIds(shareId),
	]);
	return {
		userIds: recipients.userIds.filter((id) => !currentUserIds.includes(id)),
		groupIds: recipients.groupIds.filter((id) => !currentGroupIds.includes(id)),
	};
}

async function keepProjectMembers(projectId: string, userIds: string[]): Promise<string[]> {
	const members = await projectQueries.listUsersWithProjectAccess(projectId);
	const memberIds = new Set(members.map((member) => member.id));
	return userIds.filter((id) => memberIds.has(id));
}

function notifyChatRecipients(
	chat: ManagedChat,
	actor: ShareActor,
	shareId: string,
	userIds: string[],
	deliverExternally: boolean,
): void {
	if (userIds.length === 0) {
		return;
	}
	notifySharedItem({
		projectId: actor.projectId,
		sharerId: actor.id,
		sharerName: actor.name,
		itemId: shareId,
		itemLabel: 'chat',
		itemTitle: chat.title,
		visibility: 'specific',
		allowedUserIds: userIds,
		deliverExternally,
	}).catch((error) => {
		console.error('Failed to notify shared chat recipients', error);
	});
}

function notifyChatProject(chat: ManagedChat, actor: ShareActor, shareId: string, deliverExternally: boolean): void {
	notifySharedItem({
		projectId: actor.projectId,
		sharerId: actor.id,
		sharerName: actor.name,
		itemId: shareId,
		itemLabel: 'chat',
		itemTitle: chat.title,
		visibility: 'project',
		deliverExternally,
	}).catch((error) => {
		console.error('Failed to notify project about shared chat', error);
	});
}
