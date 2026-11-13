import fs from 'node:fs';
import path from 'node:path';

import { compileRowSecurityConditions, rowSecurityTableKey, stripRowSecurityWhereClause } from '@nao/shared';
import matter from 'gray-matter';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { env } from '../env';
import * as userGroupQueries from '../queries/user-group.queries';
import { getDocsContextCatalog, getFilesContextCatalog } from './file-tree-catalog.service';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { resolveProjectSkillName } from './skill';
import type { NormalizedUserGroupsConfig, NormalizedUserGroupSettings } from './user-group-config.service';
import { parseUserGroupsConfig, UserGroupConfigError } from './user-group-config.service';
import { validateWarehouseRowPredicate } from './warehouse-sql.service';

export function readUserGroupsConfig(projectPath: string): NormalizedUserGroupsConfig {
	const configPath = path.join(projectPath, 'user_groups.yaml');
	if (!fs.existsSync(configPath)) {
		throw new UserGroupConfigError('user_groups.yaml not found in the deployed project.');
	}
	return parseUserGroupsConfig(fs.readFileSync(configPath, 'utf8'), configPath);
}

export async function validateUserGroupsConfig(
	projectId: string,
	projectPath: string,
	config: NormalizedUserGroupsConfig,
	currentConfig?: NormalizedUserGroupsConfig,
): Promise<void> {
	await assertLicenses(projectId, config, currentConfig);
	assertEnvironmentMappingsDisabled();
	assertContextReferences(projectPath, config);
	await assertRowPolicies(projectId, config);
}

async function assertLicenses(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	currentConfig?: NormalizedUserGroupsConfig,
): Promise<void> {
	if (currentConfig?.hash === config.hash) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups, { projectId }))) {
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
	const budgetChanged = currentConfig
		? config.allUsers.budgetLimitUsd !== currentConfig.allUsers.budgetLimitUsd ||
			config.groups.some(
				(group) => group.budgetLimitUsd !== (currentGroups.get(group.key)?.budgetLimitUsd ?? null),
			)
		: [config.allUsers, ...config.groups].some((group) => group.budgetLimitUsd !== null);
	if (budgetChanged && !(await hasFeature(LICENSE_FEATURES.userBudget, { projectId }))) {
		throw new UserGroupConfigError('Group budgets require a member budgets license.');
	}
	if (
		changedSettings.some(requiresRowSecurityLicense) &&
		!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))
	) {
		throw new UserGroupConfigError(
			'Row policies and restricted MCP or skill access require an Enterprise license.',
		);
	}
}

function sameLicensedSettings(left: NormalizedUserGroupSettings, right: NormalizedUserGroupSettings): boolean {
	return (
		JSON.stringify(left.mcpAccess) === JSON.stringify(right.mcpAccess) &&
		JSON.stringify(left.skillsAccess) === JSON.stringify(right.skillsAccess) &&
		JSON.stringify(left.rowPolicies) === JSON.stringify(right.rowPolicies)
	);
}

function requiresRowSecurityLicense(settings: NormalizedUserGroupSettings): boolean {
	return (
		settings.rowPolicies.policies.length > 0 ||
		settings.mcpAccess.mode === 'restricted' ||
		settings.skillsAccess.mode === 'restricted'
	);
}

function assertEnvironmentMappingsDisabled(): void {
	if (env.OIDC_GROUP_NAO_GROUP_MAPPING?.trim() || env.AZURE_AD_GROUP_NAO_GROUP_MAPPING?.trim()) {
		throw new UserGroupConfigError(
			'Environment-based OIDC and Microsoft user group mappings must be removed before enabling code management.',
		);
	}
}

function assertContextReferences(projectPath: string, config: NormalizedUserGroupsConfig): void {
	const databaseCatalog = getDatabaseContextCatalog(projectPath, { fresh: true });
	const docsCatalog = getDocsContextCatalog(projectPath);
	const filesCatalog = getFilesContextCatalog(projectPath);
	const settings = [config.allUsers, ...config.groups];
	for (const group of settings) {
		if (group.databaseAccess.mode === 'restricted') {
			for (const grant of group.databaseAccess.grants) {
				const found = databaseCatalog.objects.some(
					(object) =>
						object.databaseType === grant.databaseType &&
						object.database === grant.database &&
						object.schema === grant.schema &&
						(grant.kind === 'schema' || object.table === grant.table),
				);
				if (!found) {
					throw new UserGroupConfigError(`Unknown database access grant: ${grant.database}.${grant.schema}.`);
				}
			}
		}
		assertFileTreeReferences('docs', group.docsAccess, docsCatalog.entries);
		assertFileTreeReferences('files', group.filesAccess, filesCatalog.entries);
	}
	assertMcpReferences(projectPath, settings);
	assertSkillReferences(projectPath, settings);
}

function assertFileTreeReferences(
	label: string,
	access: NormalizedUserGroupSettings['docsAccess'],
	entries: Array<{ kind: 'folder' | 'file'; path: string }>,
): void {
	if (access.mode === 'all') {
		return;
	}
	const known = new Set(entries.map((entry) => `${entry.kind}:${entry.path}`));
	for (const grant of access.grants) {
		if (!known.has(`${grant.kind}:${grant.path}`)) {
			throw new UserGroupConfigError(`Unknown ${label} access grant: ${grant.path}.`);
		}
	}
}

function assertMcpReferences(projectPath: string, settings: NormalizedUserGroupSettings[]): void {
	const mcpRoot = path.join(projectPath, 'agent', 'mcps');
	for (const group of settings) {
		if (group.mcpAccess.mode === 'all') {
			continue;
		}
		for (const grant of group.mcpAccess.grants) {
			const serverPath = path.join(mcpRoot, grant.server);
			if (!fs.existsSync(serverPath)) {
				throw new UserGroupConfigError(`Unknown MCP server: ${grant.server}.`);
			}
			if (
				grant.kind === 'tool' &&
				!fs.existsSync(path.join(serverPath, `${encodeURIComponent(grant.tool)}.json`))
			) {
				throw new UserGroupConfigError(`Unknown MCP tool: ${grant.server}/${grant.tool}.`);
			}
		}
	}
}

function assertSkillReferences(projectPath: string, settings: NormalizedUserGroupSettings[]): void {
	const skillsPath = path.join(projectPath, 'agent', 'skills');
	const skillNames = new Set<string>();
	if (fs.existsSync(skillsPath)) {
		for (const filename of fs.readdirSync(skillsPath)) {
			if (!filename.endsWith('.md')) {
				continue;
			}
			const parsed = matter(fs.readFileSync(path.join(skillsPath, filename), 'utf8'));
			skillNames.add(resolveProjectSkillName(filename, parsed.data.name));
		}
	}
	for (const group of settings) {
		const references = [
			...group.preloadedSkills,
			...(group.skillsAccess.mode === 'restricted' ? group.skillsAccess.skills : []),
		];
		for (const skill of references) {
			if (!skillNames.has(skill)) {
				throw new UserGroupConfigError(`Unknown skill: ${skill}.`);
			}
		}
	}
}

async function assertRowPolicies(projectId: string, config: NormalizedUserGroupsConfig): Promise<void> {
	const registry = await userGroupQueries.getProjectRowSecurity(projectId);
	const registered = new Map(registry.tables.map((table) => [rowSecurityTableKey(table), table]));
	for (const settings of [config.allUsers, ...config.groups]) {
		for (const policy of settings.rowPolicies.policies) {
			const table = registered.get(rowSecurityTableKey(policy));
			if (!table) {
				throw new UserGroupConfigError('A row policy references a table outside the project registry.');
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
