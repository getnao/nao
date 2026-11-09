import { SHARE_ROLES, type ShareRole, type UserRole, type Visibility } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { DBStory } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { logActivity } from './activity';
import { notifySharedItem } from './notification.service';
import { assertCanShareToProject, assertCanShareWith } from './project-sharing.service';
import { assertShareableUserGroupIds } from './shareable-user-groups.service';
import { unshareStory } from './shared-story.service';

export type ShareActor = { id: string; name: string; role: UserRole | null; projectId: string };

export type StoryShareSettings = {
	storyId: string;
	canManage: boolean;
	isShared: boolean;
	visibility: Visibility;
	projectRole: ShareRole;
	owner: storyQueries.StoryOwner | null;
	users: sharedStoryQueries.SharedStoryUserGrant[];
	groups: sharedStoryQueries.SharedStoryGroupGrant[];
};

export type ShareGrantChange = sharedStoryQueries.SharedStoryRoleGrant;

export type StoryShareChange = {
	visibility: Visibility;
	projectRole: ShareRole;
	users: ShareGrantChange[];
	groups: ShareGrantChange[];
	notify: boolean;
};

export async function getStoryShareSettings(story: DBStory, actor: ShareActor): Promise<StoryShareSettings> {
	await assertCanSeeStoryShare(story, actor);
	const [owner, share] = await Promise.all([
		storyQueries.getStoryOwner(story.id),
		sharedStoryQueries.getSharedStoryInfo(story.id, actor.projectId),
	]);
	const [users, groups] = share
		? await Promise.all([
				sharedStoryQueries.listSharedStoryUserGrants(share.id),
				share.visibility === 'project' ? [] : sharedStoryQueries.listSharedStoryGroupGrants(share.id),
			])
		: [[], []];
	return {
		storyId: story.id,
		canManage: canManageStoryShare(owner?.id, actor),
		isShared: share !== null,
		visibility: share?.visibility ?? 'specific',
		projectRole: share?.projectRole ?? 'viewer',
		owner,
		users,
		groups,
	};
}

/** Replaces who can access the story with the given state, sharing or unsharing it as needed. */
export async function saveStoryShareSettings(
	story: DBStory,
	actor: ShareActor,
	change: StoryShareChange,
): Promise<void> {
	const ownerId = await storyQueries.getStoryOwnerId(story.id);
	const users = change.users.filter((user) => user.id !== ownerId);
	const groups = change.visibility === 'project' ? [] : change.groups;
	const recipients = { userIds: users.map((user) => user.id), groupIds: groups.map((group) => group.id) };

	if (change.visibility === 'specific' && recipients.userIds.length === 0 && recipients.groupIds.length === 0) {
		await unshareIfShared(story, actor);
		return;
	}
	if (change.visibility === 'project') {
		await assertCanShareToProject(actor.projectId, actor.id);
	}
	const existingShare = await sharedStoryQueries.getSharedStoryInfo(story.id, actor.projectId);
	const newRecipients = await listNewRecipients(existingShare?.id ?? null, recipients);
	await assertShareableUserGroupIds(actor.projectId, newRecipients.groupIds);
	await assertCanShareWith(actor.projectId, actor.id, newRecipients);

	const share = existingShare ?? (await createStoryShare(story, actor));
	const wasProjectWide = share.visibility === 'project';
	const previousProjectRole = share.projectRole;
	const affectedUserIds = await listAffectedUserIds(share.id, users, groups);
	const previousRoles = await effectiveRoles(story.id, affectedUserIds);
	await sharedStoryQueries.replaceSharedStoryAccess(share.id, {
		visibility: change.visibility,
		projectRole: change.projectRole,
		users,
		groups,
	});
	if (!existingShare || existingShare.visibility !== change.visibility) {
		await placeStoryInFolder(story, actor, ownerId, change.visibility);
	}

	const currentRoles = await effectiveRoles(story.id, affectedUserIds);
	const changes = diffRecipientRoles(previousRoles, currentRoles, actor.id);
	for (const role of SHARE_ROLES) {
		notifyRoleChange(story, actor, changes.changedTo[role], role);
	}
	if (change.visibility === 'project') {
		if (!wasProjectWide) {
			notifyProject(story, actor, change.projectRole, change.notify);
		} else if (previousProjectRole !== change.projectRole) {
			const alreadyTold = [...changes.changedTo.viewer, ...changes.changedTo.editor, actor.id, ownerId ?? ''];
			await notifyProjectRoleChange(story, actor, {
				previous: { projectRole: previousProjectRole, roles: previousRoles },
				current: { projectRole: change.projectRole, roles: currentRoles },
				excludedUserIds: alreadyTold,
			});
		}
		return;
	}
	for (const role of SHARE_ROLES) {
		notifyNewRecipients(story, actor, changes.added[role], role, change.notify);
	}
}

export function canManageStoryShare(ownerId: string | undefined, actor: Pick<ShareActor, 'id' | 'role'>): boolean {
	return ownerId === actor.id || actor.role === 'admin';
}

export async function assertCanManageStoryShare(story: DBStory, actor: ShareActor): Promise<void> {
	const projectId = story.projectId ?? (await storyQueries.getStoryProjectId(story.id));
	if (projectId !== actor.projectId) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found in this project.' });
	}
	if (!canManageStoryShare(await storyQueries.getStoryOwnerId(story.id), actor)) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can change who has access.' });
	}
}

type StoryShareRow = NonNullable<Awaited<ReturnType<typeof sharedStoryQueries.getSharedStoryInfo>>>;

async function assertCanSeeStoryShare(story: DBStory, actor: ShareActor): Promise<void> {
	if (actor.role === 'admin' || (await storyQueries.canUserAccessStory(story.id, actor.id))) {
		return;
	}
	throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this story.' });
}

/** A story is shared from its first recipient on: until then it stays private to its owner. */
async function createStoryShare(story: DBStory, actor: ShareActor): Promise<StoryShareRow> {
	const created = await sharedStoryQueries.createSharedStory({
		storyId: story.id,
		projectId: actor.projectId,
		userId: actor.id,
		visibility: 'specific',
	});
	await logActivity({
		projectId: actor.projectId,
		userId: actor.id,
		type: 'story.shared',
		storyId: story.id,
		sharedStoryId: created.id,
	});
	return created;
}

async function unshareIfShared(story: DBStory, actor: ShareActor): Promise<void> {
	const share = await sharedStoryQueries.getSharedStoryInfo(story.id, actor.projectId);
	if (share) {
		await unshareStory({ id: share.id, storyId: story.id, projectId: actor.projectId, userId: actor.id });
	}
}

/** Only the people and groups a save adds are checked: those already on the share keep their access. */
async function listNewRecipients(
	shareId: string | null,
	recipients: sharedStoryQueries.ShareRecipients,
): Promise<sharedStoryQueries.ShareRecipients> {
	if (!shareId) {
		return recipients;
	}
	const [currentUserIds, currentGroupIds] = await Promise.all([
		sharedStoryQueries.getSharedStoryAllowedUserIds(shareId),
		sharedStoryQueries.getSharedStoryAllowedGroupIds(shareId),
	]);
	return {
		userIds: recipients.userIds.filter((id) => !currentUserIds.includes(id)),
		groupIds: recipients.groupIds.filter((id) => !currentGroupIds.includes(id)),
	};
}

async function placeStoryInFolder(
	story: DBStory,
	actor: ShareActor,
	ownerId: string | undefined,
	visibility: Visibility,
): Promise<void> {
	const folderScope = { storyOwnerId: ownerId ?? actor.id, projectId: actor.projectId };
	if (visibility === 'project') {
		await storyFolderQueries.moveStoryToFolder(story.id, null, folderScope);
	} else {
		await storyFolderQueries.ensureStoryPrivate(story.id, folderScope);
	}
}

/** Everyone the save can change the access of: who the share names now, and who it is about to name. */
async function listAffectedUserIds(shareId: string, users: ShareGrantChange[], groups: ShareGrantChange[]) {
	const [currentRecipientIds, groupMemberIds] = await Promise.all([
		sharedStoryQueries.getSharedStoryRecipientUserIds(shareId),
		userGroupQueries.listUserIdsInGroups(groups.map((group) => group.id)),
	]);
	return [...new Set([...currentRecipientIds, ...users.map((user) => user.id), ...groupMemberIds])];
}

/** What each person can do with the story, whether it comes from their own role, a group's or the project's. */
async function effectiveRoles(storyId: string, userIds: string[]): Promise<Map<string, ShareRole>> {
	const roles = await Promise.all(userIds.map((userId) => sharedStoryQueries.getStoryShareRole(storyId, userId)));
	return new Map(userIds.flatMap((userId, index) => (roles[index] ? [[userId, roles[index]] as const] : [])));
}

function diffRecipientRoles(previous: Map<string, ShareRole>, current: Map<string, ShareRole>, actorId: string) {
	const added: Record<ShareRole, string[]> = { viewer: [], editor: [] };
	const changedTo: Record<ShareRole, string[]> = { viewer: [], editor: [] };
	for (const [userId, role] of current) {
		if (userId === actorId) {
			continue;
		}
		const previousRole = previous.get(userId);
		if (!previousRole) {
			added[role].push(userId);
		} else if (previousRole !== role) {
			changedTo[role].push(userId);
		}
	}
	return { added, changedTo };
}

function notifyNewRecipients(
	story: DBStory,
	actor: ShareActor,
	userIds: string[],
	role: ShareRole,
	deliverExternally: boolean,
): void {
	if (userIds.length === 0) {
		return;
	}
	notifySharedItem({
		projectId: actor.projectId,
		sharerId: actor.id,
		sharerName: actor.name,
		itemId: story.id,
		itemLabel: 'story',
		itemTitle: story.title,
		visibility: 'specific',
		allowedUserIds: userIds,
		role,
		deliverExternally,
	}).catch((error) => {
		console.error('Failed to notify shared story recipients', error);
	});
}

/** People who already had the story are told, in the app, what they can now do with it. */
function notifyRoleChange(story: DBStory, actor: ShareActor, userIds: string[], role: ShareRole): void {
	if (userIds.length === 0) {
		return;
	}
	notifySharedItem({
		projectId: actor.projectId,
		sharerId: actor.id,
		sharerName: actor.name,
		itemId: story.id,
		itemLabel: 'story',
		itemTitle: story.title,
		visibility: 'specific',
		allowedUserIds: userIds,
		role,
		isRoleChange: true,
	}).catch((error) => {
		console.error('Failed to notify a role change on a shared story', error);
	});
}

function notifyProject(story: DBStory, actor: ShareActor, role: ShareRole, deliverExternally: boolean): void {
	notifySharedItem({
		projectId: actor.projectId,
		sharerId: actor.id,
		sharerName: actor.name,
		itemId: story.id,
		itemLabel: 'story',
		itemTitle: story.title,
		visibility: 'project',
		role,
		deliverExternally,
	}).catch((error) => {
		console.error('Failed to notify project about shared story', error);
	});
}

type ProjectAccess = { projectRole: ShareRole; roles: Map<string, ShareRole> };

/** The project's role changed: members whose own role followed it hear about it, unless they were already told. */
async function notifyProjectRoleChange(
	story: DBStory,
	actor: ShareActor,
	access: { previous: ProjectAccess; current: ProjectAccess; excludedUserIds: string[] },
): Promise<void> {
	const excluded = new Set(access.excludedUserIds);
	const members = await projectQueries.listUsersWithProjectAccess(actor.projectId);
	const userIds = members
		.filter((member) => member.role !== 'viewer')
		.map((member) => member.id)
		.filter((userId) => !excluded.has(userId))
		.filter((userId) => projectAccessRole(userId, access.previous) !== projectAccessRole(userId, access.current));
	notifyRoleChange(story, actor, userIds, access.current.projectRole);
}

function projectAccessRole(userId: string, access: ProjectAccess): ShareRole {
	return access.roles.get(userId) ?? access.projectRole;
}
