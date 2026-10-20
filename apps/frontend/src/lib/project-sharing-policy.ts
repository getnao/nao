export type GroupProjectSharing = 'inherit' | 'allowed' | 'blocked';

export interface ProjectSharingSettings {
	defaultAllowed: boolean;
	groups: Record<string, GroupProjectSharing>;
}

export type ProjectSharingPolicy =
	| { canShareToProject: true }
	| { canShareToProject: false; shareableGroupIds: Set<string>; shareableMemberIds: Set<string> };

interface GroupMembership {
	groupId: string;
	userId: string;
}

interface UserGroupOverview {
	groups: Array<{ id: string; isDefault: boolean }>;
	memberships: GroupMembership[];
}

interface Share {
	userId: string;
	visibility: string;
}

export const DEFAULT_PROJECT_SHARING_SETTINGS: ProjectSharingSettings = { defaultAllowed: true, groups: {} };

export const UNRESTRICTED_PROJECT_SHARING_POLICY: ProjectSharingPolicy = { canShareToProject: true };

/** An explicit block on any of the user's groups wins over an explicit allow, which wins over the All Users default. */
export function canShareToEntireProject(settings: ProjectSharingSettings, userGroupIds: string[]): boolean {
	const overrides = userGroupIds.map((groupId) => settings.groups[groupId] ?? 'inherit');
	if (overrides.includes('blocked')) {
		return false;
	}
	if (overrides.includes('allowed')) {
		return true;
	}
	return settings.defaultAllowed;
}

export function resolveProjectSharingPolicy(
	settings: ProjectSharingSettings,
	memberships: GroupMembership[],
	userId: string,
): ProjectSharingPolicy {
	const shareableGroupIds = new Set(getUserGroupIds(memberships, userId));
	if (canShareToEntireProject(settings, [...shareableGroupIds])) {
		return UNRESTRICTED_PROJECT_SHARING_POLICY;
	}
	const shareableMemberIds = new Set(
		memberships
			.filter((membership) => shareableGroupIds.has(membership.groupId) && membership.userId !== userId)
			.map((membership) => membership.userId),
	);
	return { canShareToProject: false, shareableGroupIds, shareableMemberIds };
}

/** Project-wide shares whose owner is no longer allowed to share to the entire project under the given settings. */
export function findProjectWideSharesToRevoke<S extends Share>(
	shares: S[],
	settings: ProjectSharingSettings,
	memberships: GroupMembership[],
): S[] {
	return shares.filter(
		(share) =>
			share.visibility === 'project' &&
			!canShareToEntireProject(settings, getUserGroupIds(memberships, share.userId)),
	);
}

export function getCustomGroupMemberships(overview: UserGroupOverview): GroupMembership[] {
	const defaultGroupIds = new Set(overview.groups.filter((group) => group.isDefault).map((group) => group.id));
	return overview.memberships.filter((membership) => !defaultGroupIds.has(membership.groupId));
}

export function getSavedGroupProjectSharing(
	settings: ProjectSharingSettings,
	group: { id: string; isDefault: boolean } | null,
): GroupProjectSharing {
	if (group?.isDefault) {
		return settings.defaultAllowed ? 'allowed' : 'blocked';
	}
	return group ? (settings.groups[group.id] ?? 'inherit') : 'inherit';
}

export function withGroupProjectSharing(
	settings: ProjectSharingSettings,
	group: { id: string; isDefault: boolean },
	value: GroupProjectSharing,
): ProjectSharingSettings {
	if (group.isDefault) {
		return { ...settings, defaultAllowed: value !== 'blocked' };
	}
	const groups = { ...settings.groups, [group.id]: value };
	if (value === 'inherit') {
		delete groups[group.id];
	}
	return { ...settings, groups };
}

function getUserGroupIds(memberships: GroupMembership[], userId: string): string[] {
	return memberships.filter((membership) => membership.userId === userId).map((membership) => membership.groupId);
}
