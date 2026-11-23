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
	ResolvedUserGroupEntry,
} from './user-group-config.service';
import { resolveUserGroupsConfig, UserGroupConfigError } from './user-group-config.service';
import { assignUserGroupConfigKeys } from './user-group-config-export.service';
import { formatUserGroupsConfig } from './user-group-config-format.service';
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

export type UserGroupSettingChange =
	| { path: string; added: unknown[]; removed: unknown[] }
	| { path: string; before: unknown; after: unknown };

export interface UserGroupFileChange {
	id: string;
	action: 'added' | 'removed' | 'changed';
	settings: UserGroupSettingChange[];
}

/**
 * Compares two versions of `groups.yaml` by meaning: inheritance is resolved and lists are compared as sets.
 * The previous version is formatted first, so files written with older key names still compare.
 */
export function diffUserGroupsConfigFiles(previousSource: string | null, currentSource: string): UserGroupFileChange[] {
	const previous = previousSource ? resolveUserGroupsConfig(formatUserGroupsConfig(previousSource)) : [];
	const current = resolveUserGroupsConfig(currentSource);
	const previousById = new Map(previous.map((group) => [group.id, group]));
	const currentIds = new Set(current.map((group) => group.id));
	const changes: UserGroupFileChange[] = [
		...current.flatMap((group): UserGroupFileChange[] => {
			const before = previousById.get(group.id);
			if (!before) {
				return [{ id: group.id, action: 'added', settings: [] }];
			}
			const settings = diffGroupSettings(before, group);
			return settings.length > 0 ? [{ id: group.id, action: 'changed', settings }] : [];
		}),
		...previous
			.filter((group) => !currentIds.has(group.id))
			.map((group): UserGroupFileChange => ({ id: group.id, action: 'removed', settings: [] })),
	];
	return changes.sort((left, right) => left.id.localeCompare(right.id));
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

function diffGroupSettings(before: ResolvedUserGroupEntry, after: ResolvedUserGroupEntry): UserGroupSettingChange[] {
	const beforeLeaves = flattenSettings(before);
	const afterLeaves = flattenSettings(after);
	const paths = [...new Set([...afterLeaves.keys(), ...beforeLeaves.keys()])];
	return paths.flatMap((path): UserGroupSettingChange[] => {
		const previous = beforeLeaves.get(path);
		const next = afterLeaves.get(path);
		if (Array.isArray(previous) || Array.isArray(next)) {
			const previousItems = new Set(asArray(previous).map(canonicalJson));
			const nextItems = new Set(asArray(next).map(canonicalJson));
			const added = asArray(next).filter((item) => !previousItems.has(canonicalJson(item)));
			const removed = asArray(previous).filter((item) => !nextItems.has(canonicalJson(item)));
			return added.length > 0 || removed.length > 0 ? [{ path, added, removed }] : [];
		}
		return canonicalJson(previous) === canonicalJson(next) ? [] : [{ path, before: previous, after: next }];
	});
}

/** Maps each leaf to its dotted path. Lists are leaves, because a setting's list replaces the inherited one whole. */
function flattenSettings(value: unknown, prefix = '', leaves = new Map<string, unknown>()): Map<string, unknown> {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			flattenSettings(child, prefix ? `${prefix}.${key}` : key, leaves);
		}
	} else if (value !== undefined) {
		leaves.set(prefix, value);
	}
	return leaves;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value ?? null, (_key, child: unknown) =>
		child !== null && typeof child === 'object' && !Array.isArray(child)
			? Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)))
			: child,
	);
}

function sameStrings(left: string[], right: string[]): boolean {
	const normalizedLeft = [...new Set(left)].sort();
	return normalizedLeft.length === right.length && normalizedLeft.every((value, index) => value === right[index]);
}
