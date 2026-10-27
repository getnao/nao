import { type ProjectSharingPermission, resolveProjectSharingPermission } from '@nao/shared';
import { TRPCError } from '@trpc/server';

import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as sharedStoryQueries from '../queries/shared-story.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { UserWithRole } from '../types/project';
import type { ShareableUserGroup } from './shareable-user-groups.service';
import { unshareProjectWideStory } from './shared-story.service';
import { listActiveUserGroups } from './user-group-availability.service';

/** Project members and custom user groups a user may share with. */
export interface ShareAudience {
	canShareToProject: boolean;
	memberIds: Set<string>;
	groupIds: Set<string>;
}

export interface ShareRecipients {
	userIds?: string[];
	groupIds?: string[];
}

export interface ProjectWideShareRevocation {
	chatCount: number;
	storyCount: number;
}

interface ProjectSharingState {
	groups: Array<Pick<userGroupQueries.UserGroup, 'id' | 'name' | 'isDefault' | 'projectSharing'>>;
	users: UserWithRole[];
	memberships: Array<{ groupId: string; userId: string }>;
}

/** Everyone in the project, or only the user's custom user groups and those groups' members. */
export async function getShareAudience(projectId: string, userId: string): Promise<ShareAudience> {
	return resolveShareAudience(await loadProjectSharingState(projectId), userId);
}

export async function listShareableMembers(projectId: string, userId: string): Promise<UserWithRole[]> {
	const state = await loadProjectSharingState(projectId);
	const audience = resolveShareAudience(state, userId);
	return state.users.filter((user) => audience.memberIds.has(user.id));
}

export async function listShareableGroups(projectId: string, userId: string): Promise<ShareableUserGroup[]> {
	const state = await loadProjectSharingState(projectId);
	const audience = resolveShareAudience(state, userId);
	return state.groups
		.filter((group) => audience.groupIds.has(group.id))
		.map((group) => ({ id: group.id, name: group.name, memberCount: getGroupMemberIds(state, group.id).size }));
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
	if (userIds.every((id) => audience.memberIds.has(id)) && groupIds.every((id) => audience.groupIds.has(id))) {
		return;
	}
	throw new TRPCError({
		code: 'FORBIDDEN',
		message: audience.canShareToProject
			? 'Recipients must have access to this project.'
			: 'You can only share with your user groups and their members.',
	});
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
		await unshareProjectWideStory(storyShare);
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
		return {
			canShareToProject: true,
			memberIds: new Set(state.users.map((user) => user.id)),
			groupIds: new Set(state.groups.filter((group) => !group.isDefault).map((group) => group.id)),
		};
	}
	const groupIds = getUserGroupIds(state, userId);
	const memberIds = new Set([userId, ...[...groupIds].flatMap((groupId) => [...getGroupMemberIds(state, groupId)])]);
	return { canShareToProject: false, memberIds, groupIds };
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

function getGroupMemberIds(state: ProjectSharingState, groupId: string): Set<string> {
	return new Set(
		state.memberships.filter((membership) => membership.groupId === groupId).map(({ userId }) => userId),
	);
}
