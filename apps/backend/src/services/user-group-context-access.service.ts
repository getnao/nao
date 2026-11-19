import {
	ALL_MCP_ACCESS,
	type DatabaseContextAccess,
	type DatabaseContextTableIdentity,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	type FileTreeAccess,
	isDatabaseContextTableGranted,
	isSkillGranted,
	type McpAccess,
	type ProjectColumnSecurity,
	type ProjectRowSecurity,
	resolveWarehouseColumnSecurity,
	resolveWarehouseRowSecurity,
	type SemanticLayerMode,
	type SkillsAccess,
	unionDatabaseContextAccess,
	type UserGroupFeature,
	type UserGroupRowPolicies,
	type UserRole,
	type WarehouseColumnSecurity,
	type WarehouseRowSecurity,
} from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { getProjectById, getUserRoleInProject } from '../queries/project.queries';
import { getProjectColumnSecurity, getProjectRowSecurity } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { areAllDatabasesAllowListedOnly } from '../utils/nao-config';
import { expandDatabaseAccess, type WarehouseTableAccess } from './context-access';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { skillService } from './skill';
import {
	type AvailableUserGroupOverview,
	getAvailableUserGroupOverview,
	resolveAvailableUserGroupAccess,
} from './user-group-availability.service';

export * from './context-access';

export const MISSING_TABLE_ACCESS_MESSAGE = 'The new owner needs access to every table the current owner can access.';

export type ResolvedFileTreeAccess = { enforced: false } | { enforced: true; access: FileTreeAccess };
export type ResolvedDocsContextAccess = ResolvedFileTreeAccess;
export type ResolvedFilesContextAccess = ResolvedFileTreeAccess;
/** A restricted run also carries the project-relative files of its granted skills, since file tools see paths, not names. */
export type ResolvedSkillsAccess = { mode: 'all' } | { mode: 'restricted'; skills: string[]; grantedFiles: string[] };

export async function resolveProjectContextAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<{
	warehouseTableAccess: WarehouseTableAccess;
	warehouseColumnSecurity: WarehouseColumnSecurity;
	warehouseRowSecurity: WarehouseRowSecurity;
	docsContextAccess: ResolvedDocsContextAccess;
	filesContextAccess: ResolvedFilesContextAccess;
	mcpAccess: McpAccess;
	skillsAccess: ResolvedSkillsAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
	preloadedSkillNames: string[];
	semanticLayerModeOverride: SemanticLayerMode | null;
}> {
	const access = await resolveMemberWarehouseAccess(projectId, userId);
	const { effectiveAccess } = access;
	const catalog = getDatabaseContextCatalog(projectFolder);
	const skillsAccess = await resolveSkillsAccess(projectId, effectiveAccess.skillsAccess);
	return {
		warehouseTableAccess: expandDatabaseAccess(effectiveAccess.databaseAccess, catalog),
		warehouseColumnSecurity: access.warehouseColumnSecurity,
		warehouseRowSecurity: access.warehouseRowSecurity,
		docsContextAccess: { enforced: true, access: effectiveAccess.docsAccess },
		filesContextAccess: { enforced: true, access: effectiveAccess.filesAccess },
		mcpAccess: effectiveAccess.mcpAccess,
		skillsAccess,
		userGroupFeatures: effectiveAccess.features,
		userRulesGroupAccess: { enforced: true, groupNames: effectiveAccess.groupNames },
		preloadedSkillNames: effectiveAccess.preloadedSkills,
		semanticLayerModeOverride: effectiveAccess.semanticLayerModeOverride,
	};
}

function resolveColumnSecurityAccess(
	registry: ProjectColumnSecurity,
	columnPolicies: Parameters<typeof resolveWarehouseColumnSecurity>[1],
	isLicensed: boolean,
): WarehouseColumnSecurity {
	if (isLicensed) {
		return resolveWarehouseColumnSecurity(registry, columnPolicies);
	}
	if (registry.tables.length === 0) {
		return { enforced: false };
	}
	return {
		enforced: true,
		tables: registry.tables.map((table) => ({
			...table,
			access: 'blocked',
			reason: 'Column-level security is configured for this table but the Enterprise license is inactive. Ask an admin to restore the license or remove the table from Column-level security.',
		})),
	};
}

/** Admins configure and connect every MCP server, so their settings are never narrowed by their own groups. */
export async function resolveMcpSettingsAccess(
	projectId: string,
	userId: string,
	role: UserRole | null,
): Promise<McpAccess> {
	if (role === 'admin') {
		return ALL_MCP_ACCESS;
	}
	return (await resolveAvailableUserGroupAccess(projectId, userId)).mcpAccess;
}

/** MCP servers the user's agents may call: groups narrow every role, admins included, like agent runs do. */
export async function resolveMcpUsageAccess(projectId: string, userId: string): Promise<McpAccess> {
	return (await resolveAvailableUserGroupAccess(projectId, userId)).mcpAccess;
}

export async function resolveUserSkillsAccess(projectId: string, userId: string): Promise<SkillsAccess> {
	return (await resolveAvailableUserGroupAccess(projectId, userId)).skillsAccess;
}

export async function resolveWarehouseTableAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<WarehouseTableAccess> {
	return (await resolveProjectContextAccess(projectId, userId, projectFolder)).warehouseTableAccess;
}

/** Whether the member reads less of the warehouse than someone with every table, column and row. */
export async function hasEffectiveWarehouseRestrictions(projectId: string, userId: string): Promise<boolean> {
	const access = await resolveMemberWarehouseAccess(projectId, userId);
	const { databaseAccess } = access.effectiveAccess;
	return (
		databaseAccess.mode !== 'all' ||
		databaseAccess.strict ||
		hasRestrictedTable(access.warehouseColumnSecurity) ||
		hasRestrictedTable(access.warehouseRowSecurity)
	);
}

export async function hasTableAccessOf(
	projectId: string,
	previousOwnerId: string,
	recipientId: string,
): Promise<boolean> {
	const [recipient] = await flagRecipientsWithTableAccess(projectId, previousOwnerId, [{ id: recipientId }]);
	return recipient.hasTableAccess;
}

/**
 * Live stories and automations run with their owner's access, so a new owner must be able to query every table the
 * previous one could.
 */
export async function flagRecipientsWithTableAccess<T extends { id: string }>(
	projectId: string,
	previousOwnerId: string,
	recipients: T[],
): Promise<Array<T & { hasTableAccess: boolean }>> {
	const [project, overview] = await Promise.all([
		getProjectById(projectId),
		getAvailableUserGroupOverview(projectId),
	]);
	const tables = project?.path ? getDatabaseContextCatalog(project.path).objects : [];
	const databaseAccessByMember = resolveDatabaseAccessByMember(overview);
	const databaseAccessOf = (userId: string) => databaseAccessByMember.get(userId) ?? EMPTY_DATABASE_CONTEXT_ACCESS;
	const previousOwnerTables = resolveQueryableTables(databaseAccessOf(previousOwnerId), tables, project?.path);
	return recipients.map((recipient) => {
		const access = databaseAccessOf(recipient.id);
		const hasTableAccess = canQueryEveryTable(access, previousOwnerTables);
		return { ...recipient, hasTableAccess };
	});
}

function hasRestrictedTable(security: WarehouseColumnSecurity | WarehouseRowSecurity): boolean {
	return security.enforced && security.tables.some(({ access }) => access !== 'full');
}

function resolveDatabaseAccessByMember(overview: AvailableUserGroupOverview): Map<string, DatabaseContextAccess> {
	const accessByGroupId = new Map(
		overview.groups.flatMap((group) => (group.isLocked ? [] : [[group.id, group.databaseAccess] as const])),
	);
	const accessesByMember = new Map<string, DatabaseContextAccess[]>();
	for (const { groupId, userId } of overview.memberships) {
		const access = accessByGroupId.get(groupId);
		if (access) {
			accessesByMember.set(userId, [...(accessesByMember.get(userId) ?? []), access]);
		}
	}
	return new Map(
		[...accessesByMember].map(([userId, accesses]) => [userId, unionDatabaseContextAccess(accesses)] as const),
	);
}

/**
 * The synced tables a member's SQL can read, or null when it can also read the ones the synced catalog leaves out,
 * which a strict member can never query. Without strict mode, grants only narrow the agent's context, so SQL reads
 * every table unless each database allows only its synced tables.
 */
function resolveQueryableTables(
	access: DatabaseContextAccess,
	tables: DatabaseContextTableIdentity[],
	projectPath: string | null | undefined,
): DatabaseContextTableIdentity[] | null {
	if (access.strict) {
		return tables.filter((table) => isDatabaseContextTableGranted(access, table));
	}
	return projectPath && areAllDatabasesAllowListedOnly(projectPath) ? tables : null;
}

function canQueryEveryTable(
	access: DatabaseContextAccess,
	previousOwnerTables: DatabaseContextTableIdentity[] | null,
): boolean {
	if (!access.strict) {
		return true;
	}
	return (
		previousOwnerTables !== null &&
		previousOwnerTables.every((table) => isDatabaseContextTableGranted(access, table))
	);
}

async function resolveMemberWarehouseAccess(projectId: string, userId: string) {
	if (!(await getUserRoleInProject(projectId, userId))) {
		throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
	}
	const [effectiveAccess, isLicensed, columnSecurity, rowSecurity] = await Promise.all([
		resolveAvailableUserGroupAccess(projectId, userId),
		hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }),
		getProjectColumnSecurity(projectId),
		getProjectRowSecurity(projectId),
	]);
	return {
		effectiveAccess,
		warehouseColumnSecurity: resolveColumnSecurityAccess(
			columnSecurity,
			effectiveAccess.columnPolicies,
			isLicensed,
		),
		warehouseRowSecurity: resolveRowSecurityAccess(rowSecurity, effectiveAccess.rowPolicies, isLicensed),
	};
}

async function resolveSkillsAccess(projectId: string, access: SkillsAccess): Promise<ResolvedSkillsAccess> {
	if (access.mode === 'all') {
		return access;
	}
	try {
		await skillService.initializeSkills(projectId);
	} catch (error) {
		logger.warn(`Failed to initialize skills for project ${projectId}: ${String(error)}`, { source: 'agent' });
		return { ...access, grantedFiles: [] };
	}
	const grantedFiles = skillService
		.getSkills(projectId)
		.filter((skill) => isSkillGranted(access, skill.name))
		.map((skill) => skill.location.replace(/^\/+/, ''));
	return { ...access, grantedFiles };
}

function resolveRowSecurityAccess(
	registry: ProjectRowSecurity,
	rowPolicies: readonly UserGroupRowPolicies[],
	isLicensed: boolean,
): WarehouseRowSecurity {
	if (isLicensed) {
		return resolveWarehouseRowSecurity(registry, rowPolicies);
	}
	if (registry.tables.length === 0) {
		return { enforced: false };
	}
	return {
		enforced: true,
		tables: registry.tables.map((table) => ({
			...table,
			access: 'blocked',
			reason: 'Row-level security is configured for this table but the Enterprise license is inactive. Ask an admin to restore the license or remove the table from Row-level security.',
		})),
	};
}
