import type { DatabaseContextAccess, FileTreeAccess, McpAccess, SkillsAccess, UserGroupRowPolicies } from '@nao/shared';
import yaml from 'js-yaml';

import * as userGroupQueries from '../queries/user-group.queries';
import { getFilesContextCatalog } from './file-tree-catalog.service';
import {
	ALL_USERS_GROUP_ID,
	DEFAULT_GROUP_ID,
	DOCS_ROOT,
	HIDDEN_DEFAULTS,
	toSnakeCase,
} from './user-group-config.service';
import { listPendingUserGroupConfigAssignments } from './user-group-management.service';

type ExportedSection = Record<string, unknown>;

export async function exportUserGroupsConfig(projectId: string, projectPath: string): Promise<string> {
	const [groups, memberships, users, pendingAssignments] = await Promise.all([
		userGroupQueries.listUserGroups(projectId),
		userGroupQueries.listUserGroupMemberships(projectId),
		userGroupQueries.getUserGroupOverview(projectId).then((overview) => overview.users),
		listPendingUserGroupConfigAssignments(projectId),
	]);
	const defaultGroup = groups.find((group) => group.isDefault);
	if (!defaultGroup) {
		throw new userGroupQueries.UserGroupQueryError('NOT_FOUND', 'The All Users group is missing.');
	}
	const customGroups = groups.filter((group) => !group.isDefault);
	const keysByGroupId = assignUserGroupConfigKeys(customGroups);
	const emailsByUserId = new Map(users.map((user) => [user.id, user.email.trim().toLowerCase()]));
	const emailsByGroupId = new Map<string, Set<string>>();
	const addEmail = (groupId: string, email: string | undefined) => {
		if (email) {
			emailsByGroupId.set(groupId, (emailsByGroupId.get(groupId) ?? new Set()).add(email));
		}
	};
	for (const membership of memberships) {
		addEmail(membership.groupId, emailsByUserId.get(membership.userId));
	}
	for (const assignment of pendingAssignments) {
		addEmail(assignment.groupId, assignment.email);
	}
	const topLevelFileGrants = getFilesContextCatalog(projectPath)
		.entries.filter((entry) => !entry.path.includes('/'))
		.map((entry) => ({ kind: entry.kind, path: entry.path }));
	const exportGroup = (group: userGroupQueries.UserGroup, key: string) => ({
		id: key,
		...(group.isDefault || group.name === key ? {} : { name: group.name }),
		...(group.isDefault ? {} : membershipSection(group, emailsByGroupId.get(group.id))),
		...settingsSections(group, keysByGroupId, topLevelFileGrants),
	});

	return yaml.dump(
		{
			groups: [
				exportGroup(defaultGroup, ALL_USERS_GROUP_ID),
				...customGroups
					.map((group) => exportGroup(group, keysByGroupId.get(group.id)!))
					.sort((left, right) => left.id.localeCompare(right.id)),
			],
		},
		{ noRefs: true, lineWidth: -1, noCompatMode: true, indent: 4 },
	);
}

/** The id each custom group gets in `groups.yaml`. The first apply adopts UI groups through these same ids. */
export function assignUserGroupConfigKeys(
	groups: ReadonlyArray<{ id: string; name: string; configKey: string | null }>,
): Map<string, string> {
	const result = new Map<string, string>();
	const used = new Set([DEFAULT_GROUP_ID, ALL_USERS_GROUP_ID, ...groups.flatMap((group) => group.configKey ?? [])]);
	for (const group of [...groups].sort(
		(left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
	)) {
		if (group.configKey) {
			result.set(group.id, group.configKey);
			continue;
		}
		const base = groupIdFromName(group.name);
		let candidate = base;
		for (let suffix = 2; used.has(candidate); suffix += 1) {
			candidate = `${base}_${suffix}`;
		}
		used.add(candidate);
		result.set(group.id, candidate);
	}
	return result;
}

export function groupIdFromName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replaceAll(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '_')
		.replaceAll(/^_+|_+$/g, '')
		.slice(0, 70);
	if (!slug) {
		return 'group';
	}
	return /^[a-z]/.test(slug) ? slug : `group_${slug}`;
}

function membershipSection(
	group: userGroupQueries.UserGroup,
	emails: ReadonlySet<string> | undefined,
): ExportedSection {
	const { oidc, microsoft } = group.ssoMappings.providers;
	const hasSsoGroups = oidc.length > 0 || microsoft.length > 0 || group.ssoMappings.defaultProjectRole;
	return {
		list_of_emails: [...(emails ?? [])].sort(),
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
	keysByGroupId: ReadonlyMap<string, string>,
	topLevelFileGrants: Array<{ kind: 'folder' | 'file'; path: string }>,
): ExportedSection {
	const sections = {
		capabilities: withoutHiddenDefaults(HIDDEN_DEFAULTS.capabilities, {
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
				group_ids: group.shareTargets.groupIds.flatMap((id) => keysByGroupId.get(id) ?? []).sort(),
			},
			mcp: exportMcpAccess(group.mcpAccess),
			skills: exportSkillsAccess(group.skillsAccess, group.preloadedSkills),
		}),
		access: withoutHiddenDefaults(HIDDEN_DEFAULTS.access, {
			databases: exportDatabaseAccess(group.databaseAccess),
			files: exportFileAccess(group.docsAccess, group.filesAccess, topLevelFileGrants),
		}),
		policies: withoutHiddenDefaults(HIDDEN_DEFAULTS.policies, {
			rows: exportRowPolicies(group.rowPolicies),
			columns: [],
		}),
	};
	return Object.fromEntries(Object.entries(sections).filter(([, section]) => Object.keys(section).length > 0));
}

function withoutHiddenDefaults(defaults: object, section: ExportedSection): ExportedSection {
	const hidden = defaults as ExportedSection;
	return Object.fromEntries(
		Object.entries(section).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(hidden[key])),
	);
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

/**
 * Docs and project files are merged under `access.files`. Full project-file access next to restricted docs has no
 * restricted form, so it is exported as the project's current top-level entries.
 */
function exportFileAccess(
	docsAccess: FileTreeAccess,
	filesAccess: FileTreeAccess,
	topLevelFileGrants: Array<{ kind: 'folder' | 'file'; path: string }>,
): ExportedSection {
	if (docsAccess.mode === 'all' && filesAccess.mode === 'all') {
		return { mode: 'all' };
	}
	const docsGrants =
		docsAccess.mode === 'all'
			? [{ kind: 'folder' as const, path: DOCS_ROOT }]
			: docsAccess.grants.map((grant) => ({ kind: grant.kind, path: `${DOCS_ROOT}/${grant.path}` }));
	return {
		mode: 'restricted',
		grants: [...docsGrants, ...(filesAccess.mode === 'all' ? topLevelFileGrants : filesAccess.grants)],
	};
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
