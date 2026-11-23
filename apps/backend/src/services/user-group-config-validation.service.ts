import fs from 'node:fs';
import path from 'node:path';

import {
	columnSecurityTableKey,
	compileRowSecurityConditions,
	isDatabaseContextTableGranted,
	rowSecurityTableKey,
	stripRowSecurityWhereClause,
} from '@nao/shared';
import matter from 'gray-matter';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { env } from '../env';
import * as userGroupQueries from '../queries/user-group.queries';
import { getDocsContextCatalog, getFilesContextCatalog } from './file-tree-catalog.service';
import { hasFeature, LICENSE_FEATURES, type LicenseScope } from './license.service';
import { resolveProjectSkillFile, resolveProjectSkillName } from './skill';
import type { NormalizedUserGroupsConfig, NormalizedUserGroupSettings } from './user-group-config.service';
import {
	ALL_USERS_GROUP_ID,
	DOCS_ROOT,
	parseUserGroupsConfig,
	USER_GROUPS_CONFIG_FILENAME,
	UserGroupConfigError,
} from './user-group-config.service';
import { validateWarehouseRowPredicate } from './warehouse-sql.service';

type NamedSettings = { id: string; settings: NormalizedUserGroupSettings };

export function readUserGroupsConfig(projectPath: string): NormalizedUserGroupsConfig | null {
	const configPath = path.join(projectPath, USER_GROUPS_CONFIG_FILENAME);
	if (!fs.existsSync(configPath)) {
		return null;
	}
	return parseUserGroupsConfig(fs.readFileSync(configPath, 'utf8'), configPath);
}

export function requireUserGroupsConfig(projectPath: string): NormalizedUserGroupsConfig {
	const config = readUserGroupsConfig(projectPath);
	if (!config) {
		throw new UserGroupConfigError(
			`${USER_GROUPS_CONFIG_FILENAME} is missing. This project manages its groups as code: restore the file from Git.`,
		);
	}
	return config;
}

/** The checks that only need the project folder, shared by `nao group lint` and the server. */
export function lintUserGroupsConfig(projectPath: string, config: NormalizedUserGroupsConfig): void {
	const settings: NamedSettings[] = [
		{ id: ALL_USERS_GROUP_ID, settings: config.allUsers },
		...config.groups.map((group) => ({ id: group.key, settings: group })),
	];
	const issues = [
		...findUnknownDatabaseGrants(projectPath, settings),
		...findUnknownFileGrants(projectPath, settings),
		...findUnknownMcpGrants(projectPath, settings),
		...findUnknownSkills(projectPath, settings),
	];
	if (issues.length > 0) {
		throw new UserGroupConfigError(issues.join('\n'));
	}
}

/** `scope` is the organization when the file comes with a project that does not exist yet. */
export async function validateUserGroupsConfig(
	scope: LicenseScope,
	projectPath: string,
	config: NormalizedUserGroupsConfig,
	currentConfig?: NormalizedUserGroupsConfig,
): Promise<void> {
	await assertLicenses(scope, config, currentConfig);
	assertEnvironmentMappingsDisabled();
	lintUserGroupsConfig(projectPath, config);
	await assertRowPolicies(scope, config);
	await assertColumnPolicies(scope, config);
}

async function assertLicenses(
	scope: LicenseScope,
	config: NormalizedUserGroupsConfig,
	currentConfig?: NormalizedUserGroupsConfig,
): Promise<void> {
	if (currentConfig?.hash === config.hash) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups, scope))) {
		throw new UserGroupConfigError('Code-managed user groups require a user groups license.');
	}
	const currentGroups = new Map(currentConfig?.groups.map((group) => [group.key, group]));
	const changedSettings = [
		...(currentConfig && sameLicensedSettings(config.allUsers, currentConfig.allUsers) ? [] : [config.allUsers]),
		...config.groups.filter((group) => {
			const current = currentGroups.get(group.key);
			return !current || !sameLicensedSettings(group, current);
		}),
	];
	if (
		changedSettings.some(requiresRowSecurityLicense) &&
		!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, scope))
	) {
		throw new UserGroupConfigError(
			'Row and column policies and restricted MCP or skill access require an Enterprise license.',
		);
	}
}

function sameLicensedSettings(left: NormalizedUserGroupSettings, right: NormalizedUserGroupSettings): boolean {
	return (
		JSON.stringify(left.mcpAccess) === JSON.stringify(right.mcpAccess) &&
		JSON.stringify(left.skillsAccess) === JSON.stringify(right.skillsAccess) &&
		JSON.stringify(left.rowPolicies) === JSON.stringify(right.rowPolicies) &&
		JSON.stringify(left.columnPolicies) === JSON.stringify(right.columnPolicies)
	);
}

/** An empty restriction is the free default of every new group, so only actual grants need the license. */
function requiresRowSecurityLicense(settings: NormalizedUserGroupSettings): boolean {
	return (
		settings.rowPolicies.policies.length > 0 ||
		settings.columnPolicies.policies.length > 0 ||
		(settings.mcpAccess.mode === 'restricted' && settings.mcpAccess.grants.length > 0) ||
		(settings.skillsAccess.mode === 'restricted' && settings.skillsAccess.skills.length > 0)
	);
}

function assertEnvironmentMappingsDisabled(): void {
	if (env.OIDC_GROUP_NAO_GROUP_MAPPING?.trim() || env.AZURE_AD_GROUP_NAO_GROUP_MAPPING?.trim()) {
		throw new UserGroupConfigError(
			`Remove OIDC_GROUP_NAO_GROUP_MAPPING and AZURE_AD_GROUP_NAO_GROUP_MAPPING and declare sso_groups in ${USER_GROUPS_CONFIG_FILENAME} instead.`,
		);
	}
}

function findUnknownDatabaseGrants(projectPath: string, settings: NamedSettings[]): string[] {
	const catalog = getDatabaseContextCatalog(projectPath, { fresh: true });
	return settings.flatMap(({ id, settings: group }) =>
		group.databaseAccess.mode === 'all'
			? []
			: group.databaseAccess.grants
					.filter(
						(grant) =>
							!catalog.objects.some(
								(object) =>
									object.databaseType === grant.databaseType &&
									object.database === grant.database &&
									object.schema === grant.schema &&
									(grant.kind === 'schema' || object.table === grant.table),
							),
					)
					.map(
						(grant) =>
							`"${id}": unknown ${grant.kind} ${[grant.databaseType, grant.database, grant.schema, grant.kind === 'table' ? grant.table : null].filter(Boolean).join('.')} in access.databases. Run nao sync first.`,
					),
	);
}

function findUnknownFileGrants(projectPath: string, settings: NamedSettings[]): string[] {
	const known = new Set([
		...getDocsContextCatalog(projectPath).entries.map((entry) => `${entry.kind}:${DOCS_ROOT}/${entry.path}`),
		...getFilesContextCatalog(projectPath).entries.map((entry) => `${entry.kind}:${entry.path}`),
	]);
	return settings.flatMap(({ id, settings: group }) =>
		[
			...(group.docsAccess.mode === 'all'
				? []
				: group.docsAccess.grants.map((grant) => ({ kind: grant.kind, path: `${DOCS_ROOT}/${grant.path}` }))),
			...(group.filesAccess.mode === 'all' ? [] : group.filesAccess.grants),
		]
			.filter((grant) => !known.has(`${grant.kind}:${grant.path}`))
			.map((grant) => `"${id}": unknown ${grant.kind} ${grant.path} in access.files.`),
	);
}

function findUnknownMcpGrants(projectPath: string, settings: NamedSettings[]): string[] {
	const mcpRoot = path.join(projectPath, 'agent', 'mcps');
	return settings.flatMap(({ id, settings: group }) =>
		group.mcpAccess.mode === 'all'
			? []
			: group.mcpAccess.grants.flatMap((grant) => {
					const serverPath = path.join(mcpRoot, grant.server);
					if (!fs.existsSync(serverPath)) {
						return [`"${id}": unknown MCP server ${grant.server}.`];
					}
					if (
						grant.kind === 'tool' &&
						!fs.existsSync(path.join(serverPath, `${encodeURIComponent(grant.tool)}.json`))
					) {
						return [`"${id}": unknown MCP tool ${grant.server}/${grant.tool}.`];
					}
					return [];
				}),
	);
}

function findUnknownSkills(projectPath: string, settings: NamedSettings[]): string[] {
	const skillNames = listProjectSkillNames(projectPath);
	return settings.flatMap(({ id, settings: group }) =>
		[
			...new Set([
				...group.preloadedSkills,
				...(group.skillsAccess.mode === 'restricted' ? group.skillsAccess.skills : []),
			]),
		]
			.filter((skill) => !skillNames.has(skill))
			.map((skill) => `"${id}": unknown skill ${skill}.`),
	);
}

function listProjectSkillNames(projectPath: string): Set<string> {
	const skillsPath = path.join(projectPath, 'agent', 'skills');
	const skillNames = new Set<string>();
	if (!fs.existsSync(skillsPath)) {
		return skillNames;
	}
	for (const filename of fs.readdirSync(skillsPath)) {
		if (!filename.endsWith('.md')) {
			continue;
		}
		try {
			const skillPath = resolveProjectSkillFile(projectPath, skillsPath, path.join(skillsPath, filename));
			if (skillPath) {
				const parsed = matter(fs.readFileSync(skillPath, 'utf8'));
				skillNames.add(resolveProjectSkillName(filename, parsed.data.name));
			}
		} catch {
			continue;
		}
	}
	return skillNames;
}

async function assertRowPolicies(scope: LicenseScope, config: NormalizedUserGroupsConfig): Promise<void> {
	const registry =
		'projectId' in scope ? await userGroupQueries.getProjectRowSecurity(scope.projectId) : { tables: [] };
	const registered = new Map(registry.tables.map((table) => [rowSecurityTableKey(table), table]));
	for (const settings of [config.allUsers, ...config.groups]) {
		for (const policy of settings.rowPolicies.policies) {
			const table = registered.get(rowSecurityTableKey(policy));
			if (!table) {
				throw new UserGroupConfigError(
					`Row policy on ${policy.schema}.${policy.table} references a table that is not protected. Register it in the Row security settings first.`,
				);
			}
			if (policy.access === 'full') {
				continue;
			}
			if (
				policy.mode === 'guided' &&
				policy.conditions.some((condition) => !table.constraintColumns.includes(condition.column))
			) {
				throw new UserGroupConfigError(`Invalid constraint column for ${table.schema}.${table.table}.`);
			}
			const predicate =
				policy.mode === 'guided'
					? compileRowSecurityConditions(policy.conditions, table.databaseType, policy.combinator)
					: stripRowSecurityWhereClause(policy.predicate)!;
			await validateWarehouseRowPredicate(predicate, table.constraintColumns, table.databaseType);
		}
	}
}

async function assertColumnPolicies(scope: LicenseScope, config: NormalizedUserGroupsConfig): Promise<void> {
	const registry =
		'projectId' in scope ? await userGroupQueries.getProjectColumnSecurity(scope.projectId) : { tables: [] };
	const registered = new Map(registry.tables.map((table) => [columnSecurityTableKey(table), table]));
	for (const settings of [config.allUsers, ...config.groups]) {
		for (const policy of settings.columnPolicies.policies) {
			const table = registered.get(columnSecurityTableKey(policy));
			if (!table) {
				throw new UserGroupConfigError(
					`Column policy on ${policy.schema}.${policy.table} references a table without hidden columns. Register it in the Column security settings first.`,
				);
			}
			if (!isDatabaseContextTableGranted(settings.databaseAccess, policy)) {
				throw new UserGroupConfigError(
					`Column access cannot be granted without access to ${table.schema}.${table.table}.`,
				);
			}
			if (policy.grantedColumns.some((column) => !table.restrictedColumns.includes(column))) {
				throw new UserGroupConfigError(`Invalid granted column for ${table.schema}.${table.table}.`);
			}
		}
	}
}
