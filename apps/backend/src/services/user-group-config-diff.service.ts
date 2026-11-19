import { and, count, eq, inArray } from 'drizzle-orm';

import type { DBUserGroup } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import * as userGroupQueries from '../queries/user-group.queries';
import { previewProjectWideShareRevocationForConfig } from './project-sharing.service';
import type {
	NormalizedConfiguredUserGroup,
	NormalizedUserGroupsConfig,
	NormalizedUserGroupSettings,
} from './user-group-config.service';
import { UserGroupConfigError } from './user-group-config.service';
import { assignUserGroupConfigKeys } from './user-group-config-export.service';
import { listUsersEligibleForUserGroupConfig } from './user-group-config-membership.service';
import { getUserGroupManagementMode } from './user-group-management.service';

export type UserGroupConfigAction = 'created' | 'adopted' | 'updated' | 'archived' | 'reactivated' | 'unchanged';

export interface UserGroupConfigChange {
	action: UserGroupConfigAction;
	key: string;
	groupId: string | null;
}

export interface UserGroupConfigDiff {
	hash: string;
	mode: 'ui' | 'code';
	allUsersChanged: boolean;
	groups: UserGroupConfigChange[];
	pendingEmails: string[];
	shareRevocations: { chats: number; stories: number };
	summary: Record<UserGroupConfigAction, number>;
}

export async function diffUserGroupsConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
): Promise<UserGroupConfigDiff> {
	const [mode, groups, storedGroups, configMembers, eligibleUsers] = await Promise.all([
		getUserGroupManagementMode(projectId),
		userGroupQueries.listUserGroups(projectId),
		db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute(),
		db
			.select({ groupId: s.userGroupConfigMember.groupId, email: s.userGroupConfigMember.normalizedEmail })
			.from(s.userGroupConfigMember)
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupConfigMember.groupId))
			.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroupConfigMember.active, true)))
			.execute(),
		listUsersEligibleForUserGroupConfig(
			projectId,
			config.groups.flatMap((group) => group.members),
		),
	]);
	const defaultGroup = groups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new UserGroupConfigError('The All Users group is missing.');
	}
	const activeGroupsById = new Map(groups.map((group) => [group.id, group]));
	const storedByKey = matchStoredUserGroups(storedGroups);
	const keysByGroupId = new Map([...storedByKey].map(([key, group]) => [group.id, key]));
	const currentEmails = new Map<string, string[]>();
	for (const member of configMembers) {
		currentEmails.set(member.groupId, [...(currentEmails.get(member.groupId) ?? []), member.email]);
	}
	const changes: UserGroupConfigChange[] = config.groups.map((desired) => {
		const stored = storedByKey.get(desired.key);
		if (!stored) {
			return { action: 'created', key: desired.key, groupId: null };
		}
		if (stored.archivedAt) {
			return { action: 'reactivated', key: desired.key, groupId: stored.id };
		}
		if (!stored.configKey) {
			return { action: 'adopted', key: desired.key, groupId: stored.id };
		}
		const active = activeGroupsById.get(stored.id);
		const unchanged =
			active &&
			active.name === desired.name &&
			sameGroup(active, desired, keysByGroupId) &&
			sameStrings(currentEmails.get(active.id) ?? [], desired.members);
		return { action: unchanged ? 'unchanged' : 'updated', key: desired.key, groupId: stored.id };
	});
	const desiredKeys = new Set(config.groups.map((group) => group.key));
	for (const [key, group] of storedByKey) {
		if (!group.archivedAt && !desiredKeys.has(key)) {
			changes.push({ action: 'archived', key, groupId: group.id });
		}
	}
	const usersByEmail = groupUsersByNormalizedEmail(eligibleUsers);
	const archivedGroupIds = changes.flatMap((change) => (change.action === 'archived' ? [change.groupId!] : []));
	const [groupShareRevocations, projectShareRevocations] = await Promise.all([
		countShareRevocations(archivedGroupIds),
		previewProjectWideShareRevocationForConfig(projectId, {
			allUsersProjectSharing: config.allUsers.projectSharing,
			groups: config.groups.map((group) => ({
				projectSharing: group.projectSharing,
				userIds: group.members.flatMap((email) => usersByEmail.get(email)?.map((user) => user.id) ?? []),
			})),
		}),
	]);

	return {
		hash: config.hash,
		mode,
		allUsersChanged: !sameSettings(defaultGroup, config.allUsers, keysByGroupId),
		groups: changes.sort((left, right) => left.key.localeCompare(right.key)),
		pendingEmails: [
			...new Set(config.groups.flatMap((group) => group.members).filter((email) => !usersByEmail.has(email))),
		].sort(),
		shareRevocations: {
			chats: groupShareRevocations.chats + projectShareRevocations.chatCount,
			stories: groupShareRevocations.stories + projectShareRevocations.storyCount,
		},
		summary: Object.fromEntries(
			(['created', 'adopted', 'updated', 'archived', 'reactivated', 'unchanged'] as const).map((action) => [
				action,
				changes.filter((change) => change.action === action).length,
			]),
		) as Record<UserGroupConfigAction, number>,
	};
}

/** Active custom groups match by their exported id, archived ones by the id they had when archived. */
export function matchStoredUserGroups(storedGroups: DBUserGroup[]): Map<string, DBUserGroup> {
	const activeGroups = storedGroups.filter((group) => !group.isDefault && !group.archivedAt);
	const keysByGroupId = assignUserGroupConfigKeys(activeGroups);
	const matches = new Map(activeGroups.map((group) => [keysByGroupId.get(group.id)!, group]));
	for (const group of storedGroups) {
		if (group.archivedAt && group.configKey && !matches.has(group.configKey)) {
			matches.set(group.configKey, group);
		}
	}
	return matches;
}

function sameGroup(
	current: userGroupQueries.UserGroup,
	desired: NormalizedConfiguredUserGroup,
	keysByGroupId: ReadonlyMap<string, string>,
): boolean {
	return (
		sameSettings(current, desired, keysByGroupId) &&
		JSON.stringify(current.ssoMappings) === JSON.stringify(desired.ssoMappings)
	);
}

function sameSettings(
	current: userGroupQueries.UserGroup,
	desired: NormalizedUserGroupSettings,
	keysByGroupId: ReadonlyMap<string, string>,
): boolean {
	const stored: NormalizedUserGroupSettings = {
		features: current.featureGrants,
		toolCallDensityPolicy: current.toolCallDensityPolicy,
		showAllSettings: current.showAllSettings,
		advancedContextExplorer: current.advancedContextExplorer,
		projectSharing: current.projectSharing,
		shareTargets: {
			includeOwnGroup: current.shareTargets.includeOwnGroup,
			groupKeys: current.shareTargets.groupIds.flatMap((id) => keysByGroupId.get(id) ?? []).sort(),
		},
		preloadedSkills: current.preloadedSkills,
		databaseAccess: current.databaseAccess,
		docsAccess: current.docsAccess,
		filesAccess: current.filesAccess,
		mcpAccess: current.mcpAccess,
		skillsAccess: current.skillsAccess,
		rowPolicies: current.rowPolicies,
	};
	const comparable: NormalizedUserGroupSettings = {
		features: desired.features,
		toolCallDensityPolicy: desired.toolCallDensityPolicy,
		showAllSettings: desired.showAllSettings,
		advancedContextExplorer: desired.advancedContextExplorer,
		projectSharing: desired.projectSharing,
		shareTargets: desired.shareTargets,
		preloadedSkills: desired.preloadedSkills,
		databaseAccess: desired.databaseAccess,
		docsAccess: desired.docsAccess,
		filesAccess: desired.filesAccess,
		mcpAccess: desired.mcpAccess,
		skillsAccess: desired.skillsAccess,
		rowPolicies: desired.rowPolicies,
	};
	return JSON.stringify(stored) === JSON.stringify(comparable);
}

function groupUsersByNormalizedEmail(
	users: Array<{ id: string; email: string }>,
): Map<string, Array<{ id: string; email: string }>> {
	const grouped = new Map<string, Array<{ id: string; email: string }>>();
	for (const user of users) {
		const email = user.email.trim().toLowerCase();
		grouped.set(email, [...(grouped.get(email) ?? []), user]);
	}
	const ambiguous = [...grouped].filter(([, matches]) => matches.length > 1).map(([email]) => email);
	if (ambiguous.length > 0) {
		throw new UserGroupConfigError(`Ambiguous normalized project user emails: ${ambiguous.join(', ')}.`);
	}
	return grouped;
}

async function countShareRevocations(groupIds: string[]): Promise<{ chats: number; stories: number }> {
	if (groupIds.length === 0) {
		return { chats: 0, stories: 0 };
	}
	const [[chatCount], [storyCount]] = await Promise.all([
		db
			.select({ count: count() })
			.from(s.sharedChatGroupAccess)
			.where(inArray(s.sharedChatGroupAccess.groupId, groupIds))
			.execute(),
		db
			.select({ count: count() })
			.from(s.sharedStoryGroupAccess)
			.where(inArray(s.sharedStoryGroupAccess.groupId, groupIds))
			.execute(),
	]);
	return { chats: chatCount?.count ?? 0, stories: storyCount?.count ?? 0 };
}

function sameStrings(left: string[], right: string[]): boolean {
	const normalizedLeft = [...new Set(left)].sort();
	return normalizedLeft.length === right.length && normalizedLeft.every((value, index) => value === right[index]);
}
