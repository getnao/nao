import {
	type DatabaseContextAccess,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_FILES_CONTEXT_ACCESS,
	EMPTY_MCP_ACCESS,
	EMPTY_SKILLS_ACCESS,
	EMPTY_USER_GROUP_ROW_POLICIES,
	type FileTreeAccess,
	type UserGroupRowPolicies,
} from '@nao/shared';
import { and, eq } from 'drizzle-orm';
import yaml from 'js-yaml';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import * as memberBudgetQueries from '../queries/member-budget.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { NormalizedUserGroupSettings } from './user-group-config.service';

const EXPORT_DEFAULTS: NormalizedUserGroupSettings = {
	features: [],
	toolCallDensityPolicy: { defaultDensity: 'detailed', canChange: true },
	showAllSettings: false,
	projectSharing: 'inherit',
	shareTargets: { includeOwnGroup: true, groupKeys: [] },
	preloadedSkills: [],
	budgetLimitUsd: null,
	databaseAccess: EMPTY_DATABASE_CONTEXT_ACCESS,
	docsAccess: EMPTY_DOCS_CONTEXT_ACCESS,
	filesAccess: EMPTY_FILES_CONTEXT_ACCESS,
	mcpAccess: EMPTY_MCP_ACCESS,
	skillsAccess: EMPTY_SKILLS_ACCESS,
	rowPolicies: EMPTY_USER_GROUP_ROW_POLICIES,
};

export async function exportUserGroupsConfig(projectId: string): Promise<string> {
	const [overview, budgets, defaultBudgetSettings, storedKeys, desiredMembers] = await Promise.all([
		userGroupQueries.getUserGroupOverview(projectId),
		memberBudgetQueries.listGroupBudgets(projectId),
		memberBudgetQueries.getMemberBudgetSettings(projectId),
		db
			.select({ id: s.userGroup.id, configKey: s.userGroup.configKey })
			.from(s.userGroup)
			.where(eq(s.userGroup.projectId, projectId))
			.execute(),
		db
			.select({
				groupId: s.userGroupConfigMember.groupId,
				normalizedEmail: s.userGroupConfigMember.normalizedEmail,
			})
			.from(s.userGroupConfigMember)
			.innerJoin(s.userGroup, eq(s.userGroup.id, s.userGroupConfigMember.groupId))
			.where(and(eq(s.userGroup.projectId, projectId), eq(s.userGroupConfigMember.active, true)))
			.execute(),
	]);
	const defaultGroup = overview.groups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new userGroupQueries.UserGroupQueryError('NOT_FOUND', 'The All Users group is missing.');
	}
	const customGroups = overview.groups.filter((group) => !group.isDefault);
	const keysByGroupId = assignCandidateKeys(
		customGroups,
		new Set(storedKeys.flatMap((group) => (group.configKey ? [group.configKey] : []))),
	);
	const usersById = new Map(overview.users.map((user) => [user.id, user]));
	const memberIdsByGroup = new Map<string, Set<string>>();
	for (const membership of overview.memberships) {
		const members = memberIdsByGroup.get(membership.groupId) ?? new Set<string>();
		members.add(membership.userId);
		memberIdsByGroup.set(membership.groupId, members);
	}
	const budgetsByGroupId = new Map(budgets.map((budget) => [budget.groupId, budget.limitUsd]));
	const desiredEmailsByGroup = new Map<string, string[]>();
	for (const member of desiredMembers) {
		const emails = desiredEmailsByGroup.get(member.groupId) ?? [];
		emails.push(member.normalizedEmail);
		desiredEmailsByGroup.set(member.groupId, emails);
	}

	return yaml.dump(
		{
			version: 1,
			defaults: serializeSettings(EXPORT_DEFAULTS),
			all_users: serializeSettings(
				toSettings(defaultGroup, defaultBudgetSettings?.defaultLimitUsd || null),
				keysByGroupId,
			),
			groups: customGroups
				.map((group) => ({
					key: keysByGroupId.get(group.id)!,
					name: group.name,
					members:
						desiredEmailsByGroup.get(group.id)?.sort() ??
						[...(memberIdsByGroup.get(group.id) ?? [])]
							.flatMap((userId) => {
								const email = usersById.get(userId)?.email;
								return email ? [email.trim().toLowerCase()] : [];
							})
							.sort(),
					...serializeSettings(toSettings(group, budgetsByGroupId.get(group.id) ?? null), keysByGroupId),
				}))
				.sort((left, right) => left.key.localeCompare(right.key)),
		},
		{ noRefs: true, lineWidth: -1, noCompatMode: true },
	);
}

function assignCandidateKeys(
	groups: userGroupQueries.UserGroup[],
	reservedKeys: ReadonlySet<string>,
): Map<string, string> {
	const result = new Map<string, string>();
	const used = new Set(reservedKeys);
	for (const group of [...groups].sort(
		(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
	)) {
		if (group.configKey) {
			result.set(group.id, group.configKey);
			continue;
		}
		const base = keyFromName(group.name);
		let candidate = base;
		let suffix = 2;
		while (used.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		used.add(candidate);
		result.set(group.id, candidate);
	}
	return result;
}

function keyFromName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replaceAll(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, 70);
	if (!slug) {
		return 'group';
	}
	return /^[a-z]/.test(slug) ? slug : `group-${slug}`;
}

function toSettings(group: userGroupQueries.UserGroup, budgetLimitUsd: number | null): NormalizedUserGroupSettings {
	return {
		features: group.featureGrants,
		toolCallDensityPolicy: group.toolCallDensityPolicy,
		showAllSettings: group.showAllSettings,
		projectSharing: group.projectSharing,
		shareTargets: { includeOwnGroup: group.shareTargets.includeOwnGroup, groupKeys: group.shareTargets.groupIds },
		preloadedSkills: group.preloadedSkills,
		budgetLimitUsd,
		databaseAccess: group.databaseAccess,
		docsAccess: group.docsAccess,
		filesAccess: group.filesAccess,
		mcpAccess: group.mcpAccess,
		skillsAccess: group.skillsAccess,
		rowPolicies: group.rowPolicies,
	};
}

function serializeSettings(
	settings: NormalizedUserGroupSettings,
	keysByGroupId: ReadonlyMap<string, string> = new Map(),
): Record<string, unknown> {
	return {
		features: settings.features,
		tool_call_density: {
			default_density: settings.toolCallDensityPolicy.defaultDensity,
			can_change: settings.toolCallDensityPolicy.canChange,
		},
		show_all_settings: settings.showAllSettings,
		project_sharing: settings.projectSharing,
		share_targets: {
			include_own_group: settings.shareTargets.includeOwnGroup,
			group_keys: settings.shareTargets.groupKeys.flatMap((id) => {
				const key = keysByGroupId.get(id);
				return key ? [key] : [];
			}),
		},
		preloaded_skills: settings.preloadedSkills,
		budget_limit_usd: settings.budgetLimitUsd,
		database_access: serializeDatabaseAccess(settings.databaseAccess),
		docs_access: serializeFileTreeAccess(settings.docsAccess),
		files_access: serializeFileTreeAccess(settings.filesAccess),
		mcp_access: settings.mcpAccess,
		skills_access: settings.skillsAccess,
		row_policies: serializeRowPolicies(settings.rowPolicies),
	};
}

function serializeDatabaseAccess(access: DatabaseContextAccess): Record<string, unknown> {
	if (access.mode === 'all') {
		return access;
	}
	return {
		...access,
		grants: access.grants.map((grant) => {
			const { databaseType: database_type, ...rest } = grant;
			return { ...rest, database_type };
		}),
	};
}

function serializeFileTreeAccess(access: FileTreeAccess): FileTreeAccess {
	return access;
}

function serializeRowPolicies(rowPolicies: UserGroupRowPolicies): Record<string, unknown> {
	return {
		version: 1,
		policies: rowPolicies.policies.map((policy) => {
			const { databaseType: database_type, ...rest } = policy;
			return { ...rest, database_type };
		}),
	};
}
