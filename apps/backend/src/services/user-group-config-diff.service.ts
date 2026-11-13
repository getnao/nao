import { count, eq, inArray } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import * as memberBudgetQueries from '../queries/member-budget.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { NormalizedConfiguredUserGroup, NormalizedUserGroupsConfig } from './user-group-config.service';
import { UserGroupConfigError } from './user-group-config.service';
import { listUsersEligibleForUserGroupConfig } from './user-group-config-membership.service';
import { getUserGroupManagementMode } from './user-group-management.service';

export type UserGroupConfigAction = 'created' | 'adopted' | 'updated' | 'archived' | 'reactivated' | 'unchanged';

export interface UserGroupConfigChange {
	action: UserGroupConfigAction;
	key: string;
	name: string;
	groupId: string | null;
}

export interface UserGroupConfigDiff {
	hash: string;
	mode: 'ui' | 'code';
	allUsersChanged: boolean;
	groups: UserGroupConfigChange[];
	pendingEmails: string[];
	shareRevocations: { chats: number; stories: number };
	accessChanges: string[];
	budgetChanges: string[];
	summary: Record<UserGroupConfigAction, number>;
}

export async function diffUserGroupsConfig(
	projectId: string,
	config: NormalizedUserGroupsConfig,
): Promise<UserGroupConfigDiff> {
	const configuredEmails = config.groups.flatMap((group) => group.members);
	const [mode, overview, budgets, defaultBudgetSettings, storedGroups, configMembers, eligibleUsers] =
		await Promise.all([
			getUserGroupManagementMode(projectId),
			userGroupQueries.getUserGroupOverview(projectId),
			memberBudgetQueries.listGroupBudgets(projectId),
			memberBudgetQueries.getMemberBudgetSettings(projectId),
			db.select().from(s.userGroup).where(eq(s.userGroup.projectId, projectId)).execute(),
			db.select().from(s.userGroupConfigMember).where(eq(s.userGroupConfigMember.active, true)).execute(),
			listUsersEligibleForUserGroupConfig(projectId, configuredEmails),
		]);
	const defaultGroup = overview.groups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new UserGroupConfigError('The All Users group is missing.');
	}
	const activeCustomGroups = overview.groups.filter((group) => !group.isDefault);
	const groupsByKey = new Map(storedGroups.flatMap((group) => (group.configKey ? [[group.configKey, group]] : [])));
	const groupsByName = new Map(activeCustomGroups.map((group) => [group.name, group]));
	if (mode === 'ui') {
		const desiredNames = new Set(config.groups.map((group) => group.name));
		const missingAdoptions = activeCustomGroups.filter((group) => !desiredNames.has(group.name));
		if (missingAdoptions.length > 0) {
			throw new UserGroupConfigError(
				`Every active custom group must be adopted by name. Missing: ${missingAdoptions.map((group) => group.name).join(', ')}.`,
			);
		}
		for (const desired of config.groups) {
			const keyOwner = groupsByKey.get(desired.key);
			const adopted = groupsByName.get(desired.name);
			if (keyOwner && keyOwner.id !== adopted?.id) {
				throw new UserGroupConfigError(`Group key "${desired.key}" is already reserved by another group.`);
			}
		}
	}
	const usersById = new Map(overview.users.map((user) => [user.id, user]));
	const usersByEmail = groupUsersByNormalizedEmail(eligibleUsers);
	const currentMemberEmails = new Map<string, string[]>();
	for (const membership of overview.memberships) {
		const email = usersById.get(membership.userId)?.email.trim().toLowerCase();
		if (email) {
			currentMemberEmails.set(membership.groupId, [
				...(currentMemberEmails.get(membership.groupId) ?? []),
				email,
			]);
		}
	}
	if (mode === 'code') {
		for (const assignment of configMembers) {
			if (storedGroups.some((group) => group.id === assignment.groupId && group.projectId === projectId)) {
				currentMemberEmails.set(assignment.groupId, [
					...(currentMemberEmails.get(assignment.groupId) ?? []),
					assignment.normalizedEmail,
				]);
			}
		}
	}
	const budgetsByGroupId = new Map(budgets.map((budget) => [budget.groupId, budget.limitUsd]));
	const defaultBudgetLimitUsd = defaultBudgetSettings?.defaultLimitUsd || null;
	const keysByGroupId = new Map<string, string>();
	for (const desired of config.groups) {
		const stored = mode === 'ui' ? groupsByName.get(desired.name) : groupsByKey.get(desired.key);
		if (stored) {
			keysByGroupId.set(stored.id, desired.key);
		}
	}
	const desiredKeys = new Set(config.groups.map((group) => group.key));
	const changes = config.groups.map((desired) =>
		diffDesiredGroup(
			mode,
			desired,
			groupsByName,
			groupsByKey,
			activeCustomGroups,
			currentMemberEmails,
			budgetsByGroupId,
			keysByGroupId,
		),
	);
	for (const group of activeCustomGroups) {
		if (mode === 'code' && group.configKey && !desiredKeys.has(group.configKey)) {
			changes.push({ action: 'archived', key: group.configKey, name: group.name, groupId: group.id });
		}
	}
	const pendingEmails = [
		...new Set(config.groups.flatMap((group) => group.members).filter((email) => !usersByEmail.has(email))),
	].sort();
	const archivedGroupIds = changes.flatMap((change) =>
		change.action === 'archived' && change.groupId ? [change.groupId] : [],
	);
	const shareRevocations = await countShareRevocations(archivedGroupIds);
	const accessChanges = getAccessChanges(
		config,
		defaultGroup,
		activeCustomGroups,
		groupsByName,
		groupsByKey,
		keysByGroupId,
		currentMemberEmails,
		changes,
		mode,
	);
	const budgetChanges = getBudgetChanges(
		config,
		defaultBudgetLimitUsd,
		activeCustomGroups,
		groupsByName,
		groupsByKey,
		budgetsByGroupId,
		changes,
		mode,
	);
	const summary = Object.fromEntries(
		(['created', 'adopted', 'updated', 'archived', 'reactivated', 'unchanged'] as const).map((action) => [
			action,
			changes.filter((change) => change.action === action).length,
		]),
	) as Record<UserGroupConfigAction, number>;

	return {
		hash: config.hash,
		mode,
		allUsersChanged: !sameGroupSettings(defaultGroup, config.allUsers, defaultBudgetLimitUsd, keysByGroupId),
		groups: changes.sort((left, right) => left.key.localeCompare(right.key)),
		pendingEmails,
		shareRevocations,
		accessChanges,
		budgetChanges,
		summary,
	};
}

function getAccessChanges(
	config: NormalizedUserGroupsConfig,
	defaultGroup: userGroupQueries.UserGroup,
	activeGroups: userGroupQueries.UserGroup[],
	groupsByName: ReadonlyMap<string, userGroupQueries.UserGroup>,
	groupsByKey: ReadonlyMap<string, typeof s.userGroup.$inferSelect>,
	keysByGroupId: ReadonlyMap<string, string>,
	currentMemberEmails: ReadonlyMap<string, string[]>,
	changes: UserGroupConfigChange[],
	mode: 'ui' | 'code',
): string[] {
	const changed = new Set<string>();
	if (!sameAccessSettings(defaultGroup, config.allUsers, keysByGroupId)) {
		changed.add('all_users');
	}
	for (const desired of config.groups) {
		const stored = mode === 'ui' ? groupsByName.get(desired.name) : groupsByKey.get(desired.key);
		const active = stored ? activeGroups.find((group) => group.id === stored.id) : undefined;
		if (
			!active ||
			!sameAccessSettings(active, desired, keysByGroupId) ||
			!sameStrings(currentMemberEmails.get(active.id) ?? [], desired.members)
		) {
			changed.add(desired.key);
		}
	}
	for (const change of changes) {
		if (change.action === 'archived') {
			changed.add(change.key);
		}
	}
	return [...changed].sort();
}

function getBudgetChanges(
	config: NormalizedUserGroupsConfig,
	defaultBudgetLimitUsd: number | null,
	activeGroups: userGroupQueries.UserGroup[],
	groupsByName: ReadonlyMap<string, userGroupQueries.UserGroup>,
	groupsByKey: ReadonlyMap<string, typeof s.userGroup.$inferSelect>,
	budgetsByGroupId: ReadonlyMap<string, number>,
	changes: UserGroupConfigChange[],
	mode: 'ui' | 'code',
): string[] {
	const changed = new Set<string>();
	if (defaultBudgetLimitUsd !== config.allUsers.budgetLimitUsd) {
		changed.add('all_users');
	}
	for (const desired of config.groups) {
		const stored = mode === 'ui' ? groupsByName.get(desired.name) : groupsByKey.get(desired.key);
		const active = stored ? activeGroups.find((group) => group.id === stored.id) : undefined;
		if ((active ? (budgetsByGroupId.get(active.id) ?? null) : null) !== desired.budgetLimitUsd) {
			changed.add(desired.key);
		}
	}
	for (const change of changes) {
		if (change.action === 'archived' && change.groupId && budgetsByGroupId.has(change.groupId)) {
			changed.add(change.key);
		}
	}
	return [...changed].sort();
}

function diffDesiredGroup(
	mode: 'ui' | 'code',
	desired: NormalizedConfiguredUserGroup,
	groupsByName: ReadonlyMap<string, userGroupQueries.UserGroup>,
	groupsByKey: ReadonlyMap<string, typeof s.userGroup.$inferSelect>,
	activeGroups: userGroupQueries.UserGroup[],
	currentMemberEmails: ReadonlyMap<string, string[]>,
	budgetsByGroupId: ReadonlyMap<string, number>,
	keysByGroupId: ReadonlyMap<string, string>,
): UserGroupConfigChange {
	if (mode === 'ui') {
		const adopted = groupsByName.get(desired.name);
		return adopted
			? { action: 'adopted', key: desired.key, name: desired.name, groupId: adopted.id }
			: { action: 'created', key: desired.key, name: desired.name, groupId: null };
	}
	const stored = groupsByKey.get(desired.key);
	if (!stored) {
		return { action: 'created', key: desired.key, name: desired.name, groupId: null };
	}
	if (stored.archivedAt) {
		return { action: 'reactivated', key: desired.key, name: desired.name, groupId: stored.id };
	}
	const active = activeGroups.find((group) => group.id === stored.id);
	const unchanged =
		active &&
		sameGroupSettings(active, desired, budgetsByGroupId.get(active.id) ?? null, keysByGroupId) &&
		sameStrings(currentMemberEmails.get(active.id) ?? [], desired.members) &&
		active.name === desired.name;
	return {
		action: unchanged ? 'unchanged' : 'updated',
		key: desired.key,
		name: desired.name,
		groupId: stored.id,
	};
}

function sameGroupSettings(
	current: userGroupQueries.UserGroup,
	desired: Omit<NormalizedConfiguredUserGroup, 'key' | 'name' | 'members'>,
	budgetLimitUsd: number | null,
	keysByGroupId: ReadonlyMap<string, string>,
): boolean {
	return (
		JSON.stringify({
			features: current.featureGrants,
			toolCallDensityPolicy: current.toolCallDensityPolicy,
			showAllSettings: current.showAllSettings,
			projectSharing: current.projectSharing,
			shareTargets: {
				includeOwnGroup: current.shareTargets.includeOwnGroup,
				groupKeys: current.shareTargets.groupIds
					.flatMap((id) => {
						const key = keysByGroupId.get(id);
						return key ? [key] : [];
					})
					.sort(),
			},
			preloadedSkills: current.preloadedSkills,
			budgetLimitUsd,
			databaseAccess: current.databaseAccess,
			docsAccess: current.docsAccess,
			filesAccess: current.filesAccess,
			mcpAccess: current.mcpAccess,
			skillsAccess: current.skillsAccess,
			rowPolicies: current.rowPolicies,
		}) ===
		JSON.stringify({
			features: desired.features,
			toolCallDensityPolicy: desired.toolCallDensityPolicy,
			showAllSettings: desired.showAllSettings,
			projectSharing: desired.projectSharing,
			shareTargets: desired.shareTargets,
			preloadedSkills: desired.preloadedSkills,
			budgetLimitUsd: desired.budgetLimitUsd,
			databaseAccess: desired.databaseAccess,
			docsAccess: desired.docsAccess,
			filesAccess: desired.filesAccess,
			mcpAccess: desired.mcpAccess,
			skillsAccess: desired.skillsAccess,
			rowPolicies: desired.rowPolicies,
		})
	);
}

function sameAccessSettings(
	current: userGroupQueries.UserGroup,
	desired: Omit<NormalizedConfiguredUserGroup, 'key' | 'name' | 'members'>,
	keysByGroupId: ReadonlyMap<string, string>,
): boolean {
	return (
		JSON.stringify({
			features: current.featureGrants,
			projectSharing: current.projectSharing,
			shareTargets: {
				includeOwnGroup: current.shareTargets.includeOwnGroup,
				groupKeys: current.shareTargets.groupIds
					.flatMap((id) => {
						const key = keysByGroupId.get(id);
						return key ? [key] : [];
					})
					.sort(),
			},
			preloadedSkills: current.preloadedSkills,
			databaseAccess: current.databaseAccess,
			docsAccess: current.docsAccess,
			filesAccess: current.filesAccess,
			mcpAccess: current.mcpAccess,
			skillsAccess: current.skillsAccess,
			rowPolicies: current.rowPolicies,
		}) ===
		JSON.stringify({
			features: desired.features,
			projectSharing: desired.projectSharing,
			shareTargets: desired.shareTargets,
			preloadedSkills: desired.preloadedSkills,
			databaseAccess: desired.databaseAccess,
			docsAccess: desired.docsAccess,
			filesAccess: desired.filesAccess,
			mcpAccess: desired.mcpAccess,
			skillsAccess: desired.skillsAccess,
			rowPolicies: desired.rowPolicies,
		})
	);
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
