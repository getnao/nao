import { FREE_CUSTOM_USER_GROUP_LIMIT } from '@nao/shared';

import * as userGroupQueries from '../queries/user-group.queries';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export const LOCKED_USER_GROUP_MESSAGE =
	'This user group is inactive on the free plan. Upgrade to Enterprise to reactivate its saved settings.';

export interface LockedUserGroupSummary {
	id: string;
	projectId: string;
	name: string;
	isDefault: false;
	isLocked: true;
	createdAt: Date;
	updatedAt: Date;
}

export type AvailableUserGroup = (userGroupQueries.UserGroup & { isLocked: false }) | LockedUserGroupSummary;

export interface AvailableUserGroupOverview {
	users: userGroupQueries.UserGroupOverview['users'];
	groups: AvailableUserGroup[];
	memberships: userGroupQueries.UserGroupOverview['memberships'];
	ssoMemberships: userGroupQueries.UserGroupOverview['ssoMemberships'];
}

export async function getAvailableUserGroupOverview(projectId: string): Promise<AvailableUserGroupOverview> {
	const overview = await userGroupQueries.getUserGroupOverview(projectId);
	const groups = await applyCurrentUserGroupAvailability(overview.groups);
	const activeGroupIds = getActiveUserGroupIds(groups);

	return {
		...overview,
		groups,
		memberships: overview.memberships.filter(({ groupId }) => activeGroupIds.has(groupId)),
		ssoMemberships: overview.ssoMemberships.filter(({ groupId }) => activeGroupIds.has(groupId)),
	};
}

export async function listActiveUserGroups(projectId: string): Promise<userGroupQueries.UserGroup[]> {
	const groups = await listUserGroupsWithAvailability(projectId);
	return groups.filter((group): group is userGroupQueries.UserGroup & { isLocked: false } => !group.isLocked);
}

export async function resolveAvailableUserGroupAccess(
	projectId: string,
	userId: string,
): Promise<userGroupQueries.EffectiveUserGroupAccess> {
	const activeGroupIds = getActiveUserGroupIds(await listUserGroupsWithAvailability(projectId));
	return userGroupQueries.resolveEffectiveUserGroupAccess(projectId, userId, activeGroupIds);
}

export async function assertUserGroupManageable(projectId: string, groupId: string): Promise<void> {
	const group = (await listUserGroupsWithAvailability(projectId)).find((candidate) => candidate.id === groupId);
	if (group?.isLocked) {
		throw new userGroupQueries.UserGroupQueryError('FORBIDDEN', LOCKED_USER_GROUP_MESSAGE);
	}
}

export async function validateAssignableUserGroupIds(projectId: string, groupIds: string[]): Promise<string[]> {
	const uniqueGroupIds = [...new Set(groupIds)];
	const groups = await listUserGroupsWithAvailability(projectId);
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	if (uniqueGroupIds.some((groupId) => groupsById.get(groupId)?.isLocked)) {
		throw new userGroupQueries.UserGroupQueryError('FORBIDDEN', LOCKED_USER_GROUP_MESSAGE);
	}
	return userGroupQueries.validateAssignableUserGroupIds(projectId, uniqueGroupIds);
}

export async function applyCurrentUserGroupAvailability(
	groups: userGroupQueries.UserGroup[],
): Promise<AvailableUserGroup[]> {
	if (await hasFeature(LICENSE_FEATURES.userGroups)) {
		return groups.map((group) => ({ ...group, isLocked: false }));
	}

	const activeCustomGroupIds = new Set(
		groups
			.filter((group) => !group.isDefault)
			.sort(
				(left, right) =>
					left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
			)
			.slice(0, FREE_CUSTOM_USER_GROUP_LIMIT)
			.map((group) => group.id),
	);

	return groups.map((group) =>
		group.isDefault || activeCustomGroupIds.has(group.id)
			? { ...group, isLocked: false }
			: {
					id: group.id,
					projectId: group.projectId,
					name: group.name,
					isDefault: false,
					isLocked: true,
					createdAt: group.createdAt,
					updatedAt: group.updatedAt,
				},
	);
}

async function listUserGroupsWithAvailability(projectId: string): Promise<AvailableUserGroup[]> {
	return applyCurrentUserGroupAvailability(await userGroupQueries.listUserGroups(projectId));
}

function getActiveUserGroupIds(groups: AvailableUserGroup[]): Set<string> {
	return new Set(groups.filter((group) => !group.isLocked).map((group) => group.id));
}
