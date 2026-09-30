import { TRPCError } from '@trpc/server';

import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { listActiveUserGroups } from './user-group-availability.service';

export interface ShareableUserGroup {
	id: string;
	name: string;
	memberCount: number;
}

/** Active custom user groups; the default "All Users" group is covered by project-wide sharing. */
export async function listShareableUserGroups(projectId: string): Promise<ShareableUserGroup[]> {
	const [groups, manualMemberships, ssoMemberships, users] = await Promise.all([
		listActiveUserGroups(projectId),
		userGroupQueries.listUserGroupMemberships(projectId),
		userGroupQueries.listUserGroupSsoMemberships(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const projectUserIds = new Set(users.map((user) => user.id));
	const membersByGroupId = groupMemberIdsByGroup([...manualMemberships, ...ssoMemberships], projectUserIds);

	return groups
		.filter((group) => !group.isDefault)
		.map((group) => ({
			id: group.id,
			name: group.name,
			memberCount: membersByGroupId.get(group.id)?.size ?? 0,
		}));
}

export async function assertShareableUserGroupIds(projectId: string, groupIds: string[]): Promise<void> {
	const shareableGroupIds = await filterShareableUserGroupIds(projectId, groupIds);
	if (shareableGroupIds.length !== groupIds.length) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'One or more user groups cannot be shared with.' });
	}
}

export async function filterShareableUserGroupIds(projectId: string, groupIds: string[]): Promise<string[]> {
	if (groupIds.length === 0) {
		return [];
	}
	const shareableGroupIds = new Set((await listShareableUserGroups(projectId)).map((group) => group.id));
	return groupIds.filter((groupId) => shareableGroupIds.has(groupId));
}

function groupMemberIdsByGroup(
	memberships: Array<{ groupId: string; userId: string }>,
	projectUserIds: Set<string>,
): Map<string, Set<string>> {
	const membersByGroupId = new Map<string, Set<string>>();
	for (const { groupId, userId } of memberships) {
		if (!projectUserIds.has(userId)) {
			continue;
		}
		const members = membersByGroupId.get(groupId) ?? new Set<string>();
		members.add(userId);
		membersByGroupId.set(groupId, members);
	}
	return membersByGroupId;
}
