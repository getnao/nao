import { type ProjectSharingPermission, resolveProjectSharingPermission } from '@nao/shared';
import type { UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { unshareStory } from './shared-story.service';
import { listActiveUserGroups } from './user-group-availability.service';

export type ShareAudience =
	| { canShareToProject: true }
	| { canShareToProject: false; groupIds: Set<string>; memberIds: Set<string> };

export interface ShareRecipients {
	userIds?: string[];
	groupIds?: string[];
}

export interface ProjectWideShareRevocation {
	chatCount: number;
	storyCount: number;
}

interface ProjectSharingState {
	groups: Array<{ id: string; isDefault: boolean; projectSharing: ProjectSharingPermission }>;
	users: Array<{ id: string; role: UserRole }>;
	memberships: Array<{ groupId: string; userId: string }>;
}

const UNRESTRICTED_SHARE_AUDIENCE: ShareAudience = { canShareToProject: true };

/** Who the user may share with: everyone, or only their custom user groups and those groups' members. */
export async function getShareAudience(projectId: string, userId: string): Promise<ShareAudience> {
	return resolveShareAudience(await loadProjectSharingState(projectId), userId);
}

export async function assertCanShareToProject(projectId: string, userId: string): Promise<void> {
	assertAudienceIncludesProject(await getShareAudience(projectId, userId));
}

export async function assertCanShareWith(
	projectId: string,
	userId: string,
	recipients: ShareRecipients,
): Promise<void> {
	const { userIds = [], groupIds = [] } = recipients;
	if (userIds.length === 0 && groupIds.length === 0) {
		return;
	}
	assertAudienceIncludes(await getShareAudience(projectId, userId), recipients);
}

export function assertAudienceIncludesProject(audience: ShareAudience): void {
	if (!audience.canShareToProject) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Your user group does not allow sharing with the entire project.',
		});
	}
}

export function assertAudienceIncludes(
	audience: ShareAudience,
	{ userIds = [], groupIds = [] }: ShareRecipients,
): void {
	if (
		!userIds.every((recipientId) => isShareableMember(audience, recipientId)) ||
		!groupIds.every((groupId) => isShareableGroup(audience, groupId))
	) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'You can only share with your user groups and their members.',
		});
	}
}

export function isShareableMember(audience: ShareAudience, userId: string): boolean {
	return audience.canShareToProject || audience.memberIds.has(userId);
}

export function isShareableGroup(audience: ShareAudience, groupId: string): boolean {
	return audience.canShareToProject || audience.groupIds.has(groupId);
}

/** Counts the project-wide shares that would be unshared if the group's project sharing permission changed. */
export async function previewProjectWideShareRevocation(
	projectId: string,
	groupId: string,
	projectSharing: ProjectSharingPermission,
): Promise<ProjectWideShareRevocation> {
	const state = withGroupProjectSharing(await loadProjectSharingState(projectId), groupId, projectSharing);
	const { chatShareIds, storyShares } = await findUnauthorizedProjectWideShares(projectId, state);
	return { chatCount: chatShareIds.length, storyCount: storyShares.length };
}

/** Unshares project-wide chats and stories of users who are no longer allowed to share with the entire project. */
export async function revokeUnauthorizedProjectWideShares(projectId: string): Promise<void> {
	const state = await loadProjectSharingState(projectId);
	const { chatShareIds, storyShares } = await findUnauthorizedProjectWideShares(projectId, state);
	await sharedChatQueries.deleteSharedChats(chatShareIds);
	for (const storyShare of storyShares) {
		await unshareStory(storyShare);
	}
}

async function loadProjectSharingState(projectId: string): Promise<ProjectSharingState> {
	const [groups, manualMemberships, ssoMemberships, users] = await Promise.all([
		listActiveUserGroups(projectId),
		userGroupQueries.listUserGroupMemberships(projectId),
		userGroupQueries.listUserGroupSsoMemberships(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const customGroupIds = new Set(groups.filter((group) => !group.isDefault).map((group) => group.id));
	const userIds = new Set(users.map((user) => user.id));
	return {
		groups,
		users,
		memberships: [...manualMemberships, ...ssoMemberships].filter(
			({ groupId, userId }) => customGroupIds.has(groupId) && userIds.has(userId),
		),
	};
}

function resolveShareAudience(state: ProjectSharingState, userId: string): ShareAudience {
	if (canUserShareToProject(state, userId)) {
		return UNRESTRICTED_SHARE_AUDIENCE;
	}
	const groupIds = getUserGroupIds(state, userId);
	const memberIds = new Set([
		userId,
		...state.memberships.filter((membership) => groupIds.has(membership.groupId)).map(({ userId }) => userId),
	]);
	return { canShareToProject: false, groupIds, memberIds };
}

/** Admins manage this permission, so they can always share with the entire project. */
function canUserShareToProject(state: ProjectSharingState, userId: string): boolean {
	if (state.users.some((user) => user.id === userId && user.role === 'admin')) {
		return true;
	}
	const groupIds = getUserGroupIds(state, userId);
	return resolveProjectSharingPermission(state.groups.filter((group) => group.isDefault || groupIds.has(group.id)));
}

async function findUnauthorizedProjectWideShares(projectId: string, state: ProjectSharingState) {
	const restrictedUserIds = state.users
		.filter((user) => !canUserShareToProject(state, user.id))
		.map((user) => user.id);
	const [chatShareIds, storyShares] = await Promise.all([
		sharedChatQueries.listProjectWideSharedChatIds(projectId, restrictedUserIds),
		sharedStoryQueries.listProjectWideSharedStories(projectId, restrictedUserIds),
	]);
	return { chatShareIds, storyShares };
}

function withGroupProjectSharing(
	state: ProjectSharingState,
	groupId: string,
	projectSharing: ProjectSharingPermission,
): ProjectSharingState {
	return {
		...state,
		groups: state.groups.map((group) => (group.id === groupId ? { ...group, projectSharing } : group)),
	};
}

function getUserGroupIds(state: ProjectSharingState, userId: string): Set<string> {
	return new Set(
		state.memberships.filter((membership) => membership.userId === userId).map(({ groupId }) => groupId),
	);
}
