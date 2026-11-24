import {
	columnSecurityTableKey,
	compileRowSecurityConditions,
	isDatabaseContextTableGranted,
	rowSecurityTableKey,
	serializeUserGroupColumnPolicies,
	serializeUserGroupConfig,
	serializeUserGroupContextAccess,
	serializeUserGroupRowPolicies,
	serializeUserGroupSsoMappings,
	stripRowSecurityWhereClause,
} from '@nao/shared';

import type { DBProject, NewProject, NewUserGroup } from '../db/abstractSchema';
import { env, isCloud } from '../env';
import * as groupsConfigQueries from '../queries/groups-config.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger, serializeError } from '../utils/logger';
import {
	assignConfigIds,
	GroupsConfigError,
	lintGroupsConfig,
	type NormalizedUserGroupsConfig,
	type NormalizedUserGroupSettings,
	readGroupsConfig,
	requireGroupsConfig,
} from './groups-config.service';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { revokeUnauthorizedProjectWideShares } from './project-sharing.service';
import { validateWarehouseRowPredicate } from './warehouse-sql.service';

export const CODE_MANAGED_GROUPS_MESSAGE =
	'This project manages user groups in groups.yaml. Edit and deploy that file instead.';

export async function validateProjectGroupsFile(
	projectId: string,
	projectPath: string,
	required: boolean,
): Promise<NormalizedUserGroupsConfig | null> {
	const config = required ? requireGroupsConfig(projectPath) : readGroupsConfig(projectPath);
	if (!config) {
		return null;
	}
	lintGroupsConfig(projectPath, config);
	const plan = await buildWritePlan(projectId, config, null);
	if (!required || !changesOnlyMemberEmails(plan)) {
		await validateGroupsConfig(projectId, config);
	}
	return config;
}

export async function validateNewProjectGroupsFile(
	orgId: string,
	projectPath: string,
): Promise<NormalizedUserGroupsConfig | null> {
	const config = readGroupsConfig(projectPath);
	if (!config) {
		return null;
	}
	lintGroupsConfig(projectPath, config);
	if (!(await hasFeature(LICENSE_FEATURES.userGroups, { orgId }))) {
		throw new GroupsConfigError('Code-managed user groups require a user groups license.');
	}
	if ([config.allUsers, ...config.groups].some((settings) => settings.rowPolicies.policies.length > 0)) {
		throw new GroupsConfigError('Register protected tables before defining row policies in groups.yaml.');
	}
	if ([config.allUsers, ...config.groups].some((settings) => settings.columnPolicies.policies.length > 0)) {
		throw new GroupsConfigError('Register hidden columns before defining column policies in groups.yaml.');
	}
	if (requiresRowSecurityLicense(config) && !(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { orgId }))) {
		throw new GroupsConfigError('Restricted MCP or skill access requires an Enterprise license.');
	}
	if (requiresSsoLicense(config) && !(await hasFeature(LICENSE_FEATURES.sso, { orgId }))) {
		throw new GroupsConfigError('SSO group mappings require an Enterprise license.');
	}
	return config;
}

export async function applyProjectGroupsFile(
	projectId: string,
	projectPath: string,
	actorUserId: string | null,
): Promise<boolean> {
	let config: NormalizedUserGroupsConfig | null = null;
	try {
		config = readGroupsConfig(projectPath);
		if (config) {
			lintGroupsConfig(projectPath, config);
		}
		const changed = await withGroupsConfigLock(projectId, async () => {
			const managed = await groupsConfigQueries.isGroupsConfigManaged(projectId);
			const requiredConfig = managed ? (config ?? requireGroupsConfig(projectPath)) : config;
			if (!requiredConfig) {
				return false;
			}
			if ((await groupsConfigQueries.getLastAppliedGroupsConfigHash(projectId)) === requiredConfig.hash) {
				return false;
			}
			const plan = await buildWritePlan(projectId, requiredConfig, actorUserId);
			if (!managed || !changesOnlyMemberEmails(plan)) {
				await validateGroupsConfig(projectId, requiredConfig);
			}
			await groupsConfigQueries.applyGroupsConfigWritePlan(plan);
			return true;
		});
		if (config || (await groupsConfigQueries.isGroupsConfigManaged(projectId))) {
			await revokeUnauthorizedProjectWideShares(projectId);
		}
		return changed;
	} catch (error) {
		await groupsConfigQueries.recordGroupsConfigFailure(projectId, actorUserId, error, config?.hash ?? null);
		throw error;
	}
}

export async function createProjectWithGroupsConfig(
	project: NewProject,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
): Promise<DBProject> {
	const projectWithId = { ...project, id: project.id ?? crypto.randomUUID() };
	const plan = buildNewProjectWritePlan(projectWithId.id, config, actorUserId);
	return groupsConfigQueries.createProjectWithGroupsConfig(projectWithId, plan);
}

export async function applyAllProjectGroupsFiles(): Promise<void> {
	const failures: string[] = [];
	for (const project of await projectQueries.listProjectFolders()) {
		try {
			await applyProjectGroupsFile(project.id, project.path, null);
		} catch (error) {
			const message = `${project.path}: ${error instanceof Error ? error.message : String(error)}`;
			failures.push(message);
			if (isCloud) {
				logger.error(`groups.yaml could not be applied at startup. ${message}`, {
					source: 'system',
					context: serializeError(error),
				});
			}
		}
	}
	if (failures.length > 0 && !isCloud) {
		throw new GroupsConfigError(`groups.yaml could not be applied.\n${failures.join('\n')}`);
	}
}

export async function reconcileGroupsMembershipsForUser(userId: string): Promise<void> {
	const user = await userQueries.getUser({ id: userId });
	if (!user) {
		return;
	}
	const projects = await projectQueries.listUserProjects(userId, { includeInactive: true });
	for (const project of projects) {
		if (!(await groupsConfigQueries.isGroupsConfigManaged(project.id))) {
			continue;
		}
		await withGroupsConfigLock(project.id, async () => {
			const groups = await groupsConfigQueries.listStoredUserGroups(project.id);
			const email = user.email.trim().toLowerCase();
			const groupIds = groups
				.filter(
					(group) =>
						!group.isDefault && group.archivedAt === null && (group.memberEmails ?? []).includes(email),
				)
				.map((group) => group.id);
			await groupsConfigQueries.setConfigMembershipsForUser(project.id, userId, groupIds);
		});
		await revokeUnauthorizedProjectWideShares(project.id);
	}
}

export async function assertGroupsUiManaged(projectId: string): Promise<void> {
	if (await groupsConfigQueries.isGroupsConfigManaged(projectId)) {
		throw new userGroupQueries.UserGroupQueryError('FORBIDDEN', CODE_MANAGED_GROUPS_MESSAGE);
	}
}

export async function getGroupsConfigStatus(projectId: string): Promise<{
	mode: 'ui' | 'code';
	appliedAt: Date | null;
	lastAttemptFailed: boolean;
	errorMessage: string | null;
	pendingEmails: Array<{ groupId: string; groupName: string; email: string }>;
}> {
	const status = await groupsConfigQueries.getGroupsConfigStatus(projectId);
	if (!status.appliedAt) {
		return { mode: 'ui', ...status, pendingEmails: [] };
	}
	const [groups, users] = await Promise.all([
		groupsConfigQueries.listStoredUserGroups(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const userEmails = new Set(users.map((user) => user.email.trim().toLowerCase()));
	const pendingEmails = groups
		.filter((group) => !group.isDefault && group.archivedAt === null)
		.flatMap((group) =>
			(group.memberEmails ?? [])
				.filter((email) => !userEmails.has(email))
				.map((email) => ({ groupId: group.id, groupName: group.name, email })),
		);
	return { mode: 'code', ...status, pendingEmails };
}

export function withGroupsConfigLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
	return withKeyedLock(`user-groups:${projectId}`, task);
}

async function validateGroupsConfig(projectId: string, config: NormalizedUserGroupsConfig): Promise<void> {
	if (env.OIDC_GROUP_NAO_GROUP_MAPPING?.trim() || env.AZURE_AD_GROUP_NAO_GROUP_MAPPING?.trim()) {
		throw new GroupsConfigError(
			'Remove OIDC_GROUP_NAO_GROUP_MAPPING and AZURE_AD_GROUP_NAO_GROUP_MAPPING and declare sso_groups in groups.yaml instead.',
		);
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups, { projectId }))) {
		throw new GroupsConfigError('Code-managed user groups require a user groups license.');
	}
	if (requiresRowSecurityLicense(config) && !(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new GroupsConfigError(
			'Row and column policies and restricted MCP or skill access require an Enterprise license.',
		);
	}
	if (requiresSsoLicense(config) && !(await hasFeature(LICENSE_FEATURES.sso, { projectId }))) {
		throw new GroupsConfigError('SSO group mappings require an Enterprise license.');
	}
	await Promise.all([assertRowPolicies(projectId, config), assertColumnPolicies(projectId, config)]);
}

function requiresRowSecurityLicense(config: NormalizedUserGroupsConfig): boolean {
	return [config.allUsers, ...config.groups].some(
		(settings) =>
			settings.rowPolicies.policies.length > 0 ||
			settings.columnPolicies.policies.length > 0 ||
			(settings.mcpAccess.mode === 'restricted' && settings.mcpAccess.grants.length > 0) ||
			(settings.skillsAccess.mode === 'restricted' && settings.skillsAccess.skills.length > 0),
	);
}

function requiresSsoLicense(config: NormalizedUserGroupsConfig): boolean {
	return config.groups.some(
		(settings) =>
			settings.ssoMappings.providers.oidc.length > 0 ||
			settings.ssoMappings.providers.microsoft.length > 0 ||
			settings.ssoMappings.defaultProjectRole !== null,
	);
}

async function buildWritePlan(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
): Promise<groupsConfigQueries.GroupsConfigWritePlan> {
	const [storedGroups, users] = await Promise.all([
		groupsConfigQueries.listStoredUserGroups(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const allUsers = storedGroups.find((group) => group.isDefault);
	if (!allUsers) {
		throw new GroupsConfigError('The All Users group is missing.');
	}
	const customGroups = storedGroups.filter((group) => !group.isDefault);
	const assignedIds = assignConfigIds(customGroups);
	const storedByConfigId = new Map(customGroups.map((group) => [assignedIds.get(group.id)!, group]));
	const desiredIds = new Set(config.groups.map((group) => group.configId));
	const archivedGroups = customGroups
		.filter((group) => group.archivedAt === null && !desiredIds.has(assignedIds.get(group.id)!))
		.map((group) => ({ group, configId: assignedIds.get(group.id)! }));
	const idsByConfigId = new Map(
		config.groups.map((group) => [group.configId, storedByConfigId.get(group.configId)?.id ?? crypto.randomUUID()]),
	);
	const usersByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user.id]));
	const groups = config.groups.map((desired) => {
		const existing = storedByConfigId.get(desired.configId);
		const id = idsByConfigId.get(desired.configId)!;
		return {
			id,
			existing,
			values: {
				id,
				projectId,
				name: desired.name,
				isDefault: false,
				configId: desired.configId,
				archivedAt: null,
				memberEmails: desired.memberEmails,
				ssoMappings: serializeUserGroupSsoMappings(desired.ssoMappings),
				...storedSettings(desired, idsByConfigId),
			},
			memberUserIds: desired.memberEmails.flatMap((email) => usersByEmail.get(email) ?? []),
			changedSsoProviders: existing
				? userGroupQueries.getChangedSsoProviders(
						existing.ssoMappings,
						serializeUserGroupSsoMappings(desired.ssoMappings),
					)
				: [],
		};
	});
	return {
		projectId,
		actorUserId,
		hash: config.hash,
		allUsersId: allUsers.id,
		allUsersExisting: allUsers,
		allUsersValues: storedSettings(config.allUsers, idsByConfigId),
		groups,
		archivedGroups,
	};
}

function storedSettings(
	settings: NormalizedUserGroupSettings,
	idsByConfigId: ReadonlyMap<string, string>,
): Pick<NewUserGroup, 'featureGrants' | 'contextGrants' | 'rowPolicies' | 'columnPolicies'> {
	return {
		featureGrants: serializeUserGroupConfig(
			settings.features,
			settings.toolCallDensityPolicy,
			settings.projectSharing,
			settings.showAllSettings,
			settings.preloadedSkills,
			{
				includeOwnGroup: settings.shareTargets.includeOwnGroup,
				groupIds: settings.shareTargets.configIds.map((configId) => idsByConfigId.get(configId)!),
			},
			settings.advancedContextExplorer,
		),
		contextGrants: serializeUserGroupContextAccess({
			databaseAccess: settings.databaseAccess,
			docsAccess: settings.docsAccess,
			filesAccess: settings.filesAccess,
			mcpAccess: settings.mcpAccess,
			skillsAccess: settings.skillsAccess,
		}),
		rowPolicies: serializeUserGroupRowPolicies(settings.rowPolicies),
		columnPolicies: serializeUserGroupColumnPolicies(settings.columnPolicies),
	};
}

function buildNewProjectWritePlan(
	projectId: string,
	config: NormalizedUserGroupsConfig,
	actorUserId: string | null,
): groupsConfigQueries.GroupsConfigWritePlan {
	const allUsersId = crypto.randomUUID();
	const idsByConfigId = new Map(config.groups.map((group) => [group.configId, crypto.randomUUID()]));
	return {
		projectId,
		actorUserId,
		hash: config.hash,
		allUsersId,
		allUsersValues: storedSettings(config.allUsers, idsByConfigId),
		groups: config.groups.map((desired) => {
			const id = idsByConfigId.get(desired.configId)!;
			return {
				id,
				values: {
					id,
					projectId,
					name: desired.name,
					isDefault: false,
					configId: desired.configId,
					archivedAt: null,
					memberEmails: desired.memberEmails,
					ssoMappings: serializeUserGroupSsoMappings(desired.ssoMappings),
					...storedSettings(desired, idsByConfigId),
				},
				memberUserIds: [],
				changedSsoProviders: [],
			};
		}),
		archivedGroups: [],
	};
}

function changesOnlyMemberEmails(plan: groupsConfigQueries.GroupsConfigWritePlan): boolean {
	if (!plan.allUsersExisting || plan.archivedGroups.length > 0 || plan.groups.some((group) => !group.existing)) {
		return false;
	}
	const allUsersExisting = plan.allUsersExisting;
	const settingsKeys = ['featureGrants', 'contextGrants', 'rowPolicies', 'columnPolicies'] as const;
	const allUsersSettingsUnchanged = settingsKeys.every(
		(key) => JSON.stringify(plan.allUsersValues[key]) === JSON.stringify(allUsersExisting[key]),
	);
	return (
		allUsersSettingsUnchanged &&
		plan.groups.every(
			(group) =>
				group.existing?.name === group.values.name &&
				group.existing.configId === group.values.configId &&
				JSON.stringify(group.existing.ssoMappings) === JSON.stringify(group.values.ssoMappings) &&
				settingsKeys.every(
					(key) => JSON.stringify(group.existing?.[key]) === JSON.stringify(group.values[key]),
				),
		)
	);
}

async function assertRowPolicies(projectId: string, config: NormalizedUserGroupsConfig): Promise<void> {
	const registry = await userGroupQueries.getProjectRowSecurity(projectId);
	const registered = new Map(registry.tables.map((table) => [rowSecurityTableKey(table), table]));
	for (const settings of [config.allUsers, ...config.groups]) {
		for (const policy of settings.rowPolicies.policies) {
			const table = registered.get(rowSecurityTableKey(policy));
			if (!table) {
				throw new GroupsConfigError(
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
				throw new GroupsConfigError(`Invalid constraint column for ${table.schema}.${table.table}.`);
			}
			const predicate =
				policy.mode === 'guided'
					? compileRowSecurityConditions(policy.conditions, table.databaseType, policy.combinator)
					: stripRowSecurityWhereClause(policy.predicate)!;
			await validateWarehouseRowPredicate(predicate, table.constraintColumns, table.databaseType);
		}
	}
}

async function assertColumnPolicies(projectId: string, config: NormalizedUserGroupsConfig): Promise<void> {
	const registry = await userGroupQueries.getProjectColumnSecurity(projectId);
	const registered = new Map(registry.tables.map((table) => [columnSecurityTableKey(table), table]));
	for (const settings of [config.allUsers, ...config.groups]) {
		for (const policy of settings.columnPolicies.policies) {
			const table = registered.get(columnSecurityTableKey(policy));
			if (!table) {
				throw new GroupsConfigError(
					`Column policy on ${policy.schema}.${policy.table} references a table without hidden columns. Register it in the Column security settings first.`,
				);
			}
			if (!isDatabaseContextTableGranted(settings.databaseAccess, policy)) {
				throw new GroupsConfigError(
					`Column access cannot be granted without access to ${table.schema}.${table.table}.`,
				);
			}
			if (policy.grantedColumns.some((column) => !table.restrictedColumns.includes(column))) {
				throw new GroupsConfigError(`Invalid granted column for ${table.schema}.${table.table}.`);
			}
		}
	}
}
