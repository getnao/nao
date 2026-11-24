import type {
	DatabaseContextAccess,
	FileTreeAccess,
	McpAccess,
	SkillsAccess,
	UserGroupColumnPolicies,
	UserGroupRowPolicies,
} from '@nao/shared';
import { stringify } from 'yaml';

import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { ALL_USERS_GROUP_ID, assignConfigIds, toSnakeCase } from './groups-config.service';

type ExportedSection = Record<string, unknown>;

export async function exportGroupsConfig(projectId: string): Promise<string> {
	const [groups, users, manualMemberships] = await Promise.all([
		userGroupQueries.listUserGroups(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
		userGroupQueries.listUserGroupMemberships(projectId),
	]);
	const allUsers = groups.find((group) => group.isDefault);
	if (!allUsers) {
		throw new userGroupQueries.UserGroupQueryError('NOT_FOUND', 'The All Users group is missing.');
	}
	const customGroups = groups.filter((group) => !group.isDefault);
	const configIdsByGroupId = assignConfigIds(customGroups);
	const emailsByUserId = new Map(users.map((user) => [user.id, user.email.trim().toLowerCase()]));
	const membershipEmails = new Map<string, Set<string>>();
	for (const membership of manualMemberships) {
		const email = emailsByUserId.get(membership.userId);
		if (email) {
			membershipEmails.set(
				membership.groupId,
				(membershipEmails.get(membership.groupId) ?? new Set()).add(email),
			);
		}
	}
	const exportGroup = (group: userGroupQueries.UserGroup, configId: string) => ({
		id: configId,
		...(group.isDefault || group.name === configId ? {} : { name: group.name }),
		...(group.isDefault
			? {}
			: membershipSection(group, group.memberEmails ?? [...(membershipEmails.get(group.id) ?? [])].sort())),
		...settingsSections(group, configIdsByGroupId),
	});
	return stringify(
		{
			groups: [
				exportGroup(allUsers, ALL_USERS_GROUP_ID),
				...customGroups
					.map((group) => exportGroup(group, configIdsByGroupId.get(group.id)!))
					.sort((left, right) => left.id.localeCompare(right.id)),
			],
		},
		{ indent: 4, lineWidth: 0 },
	);
}

function membershipSection(group: userGroupQueries.UserGroup, memberEmails: string[]): ExportedSection {
	const { oidc, microsoft } = group.ssoMappings.providers;
	const hasSsoGroups = oidc.length > 0 || microsoft.length > 0 || group.ssoMappings.defaultProjectRole;
	return {
		list_of_emails: [...new Set(memberEmails)].sort(),
		...(hasSsoGroups
			? {
					sso_groups: {
						oidc,
						microsoft,
						...(group.ssoMappings.defaultProjectRole
							? { default_project_role: group.ssoMappings.defaultProjectRole }
							: {}),
					},
				}
			: {}),
	};
}

function settingsSections(
	group: userGroupQueries.UserGroup,
	configIdsByGroupId: ReadonlyMap<string, string>,
): ExportedSection {
	return {
		capabilities: {
			features: group.featureGrants.map(toSnakeCase),
			tool_call_density: {
				default_density: group.toolCallDensityPolicy.defaultDensity,
				can_change: group.toolCallDensityPolicy.canChange,
			},
			show_all_settings: group.showAllSettings,
			advanced_context_explorer: group.advancedContextExplorer,
			project_sharing: group.projectSharing,
			share_targets: {
				include_own_group: group.shareTargets.includeOwnGroup,
				group_ids: group.shareTargets.groupIds.flatMap((id) => configIdsByGroupId.get(id) ?? []).sort(),
			},
			mcp: exportMcpAccess(group.mcpAccess),
			skills: exportSkillsAccess(group.skillsAccess, group.preloadedSkills),
		},
		access: {
			databases: exportDatabaseAccess(group.databaseAccess),
			files: exportFileAccess(group.docsAccess, group.filesAccess),
		},
		policies: {
			rows: exportRowPolicies(group.rowPolicies),
			columns: exportColumnPolicies(group.columnPolicies),
		},
	};
}

function exportMcpAccess(access: McpAccess): ExportedSection {
	return access.mode === 'all' ? { mode: 'all' } : { mode: 'restricted', grants: access.grants };
}

function exportSkillsAccess(access: SkillsAccess, preloaded: string[]): ExportedSection {
	return access.mode === 'all'
		? { mode: 'all', preloaded }
		: { mode: 'restricted', allowed: access.skills, preloaded };
}

function exportDatabaseAccess(access: DatabaseContextAccess): ExportedSection {
	if (access.mode === 'all') {
		return { mode: 'all', strict: access.strict };
	}
	return {
		mode: 'restricted',
		strict: access.strict,
		grants: access.grants.map(({ kind, databaseType: database_type, ...grant }) => ({
			kind,
			database_type,
			...grant,
		})),
		patterns: access.patterns,
	};
}

function exportFileAccess(docsAccess: FileTreeAccess, filesAccess: FileTreeAccess): ExportedSection {
	const docsGrants =
		docsAccess.mode === 'all'
			? [{ kind: 'folder' as const, path: 'docs' }]
			: docsAccess.grants.map((grant) => ({ kind: grant.kind, path: `docs/${grant.path}` }));
	if (filesAccess.mode === 'all') {
		return docsAccess.mode === 'all' ? { mode: 'all' } : { mode: 'all', docs_grants: docsGrants };
	}
	return { mode: 'restricted', grants: [...docsGrants, ...filesAccess.grants] };
}

function exportColumnPolicies(columnPolicies: UserGroupColumnPolicies): ExportedSection[] {
	return columnPolicies.policies.map(({ databaseType: database_type, database, schema, table, grantedColumns }) => ({
		database_type,
		database,
		schema,
		table,
		granted_columns: grantedColumns,
	}));
}

function exportRowPolicies(rowPolicies: UserGroupRowPolicies): ExportedSection[] {
	return rowPolicies.policies.map((row) => {
		const { databaseType: database_type, database, schema, table } = row;
		const identity = { database_type, database, schema, table };
		if (row.access === 'full') {
			return { ...identity, access: 'full' };
		}
		if (row.mode === 'sql') {
			return { ...identity, access: 'predicate', mode: 'sql', predicate: row.predicate };
		}
		return {
			...identity,
			access: 'predicate',
			mode: 'guided',
			combinator: row.combinator,
			conditions: row.conditions.map((condition) => {
				const operator = toSnakeCase(condition.operator);
				if (condition.operator === 'is-one-of' || condition.operator === 'is-not-one-of') {
					return {
						column: condition.column,
						operator,
						values: (condition.value ?? '').split(',').map((value) => value.trim()),
					};
				}
				return condition.value === undefined
					? { column: condition.column, operator }
					: { column: condition.column, operator, value: condition.value };
			}),
		};
	});
}
