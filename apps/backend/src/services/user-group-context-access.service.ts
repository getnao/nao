import {
	ALL_MCP_ACCESS,
	type FileTreeAccess,
	isSkillGranted,
	type McpAccess,
	type ProjectRowSecurity,
	resolveWarehouseRowSecurity,
	type SkillsAccess,
	type UserGroupFeature,
	type UserGroupRowPolicies,
	type UserRole,
	type WarehouseRowSecurity,
} from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { getUserRoleInProject } from '../queries/project.queries';
import { getProjectRowSecurity } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { expandDatabaseAccess, type WarehouseTableAccess } from './context-access';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { skillService } from './skill';
import { resolveAvailableUserGroupAccess } from './user-group-availability.service';

export * from './context-access';

export type ResolvedFileTreeAccess = { enforced: false } | { enforced: true; access: FileTreeAccess };
export type ResolvedDocsContextAccess = ResolvedFileTreeAccess;
export type ResolvedFilesContextAccess = ResolvedFileTreeAccess;
/** A restricted run also carries the project-relative files of its granted skills, since file tools see paths, not names. */
export type ResolvedSkillsAccess = { mode: 'all' } | { mode: 'restricted'; skills: string[]; grantedFiles: string[] };

export async function resolveProjectContextAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
	options: { projectAccessAlreadyAuthorized?: boolean } = {},
): Promise<{
	warehouseTableAccess: WarehouseTableAccess;
	warehouseRowSecurity: WarehouseRowSecurity;
	docsContextAccess: ResolvedDocsContextAccess;
	filesContextAccess: ResolvedFilesContextAccess;
	mcpAccess: McpAccess;
	skillsAccess: ResolvedSkillsAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
	preloadedSkillNames: string[];
}> {
	if (!options.projectAccessAlreadyAuthorized && !(await getUserRoleInProject(projectId, userId))) {
		throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
	}

	const [effectiveAccess, catalog, rowSecurityLicensed, rowSecurity] = await Promise.all([
		resolveAvailableUserGroupAccess(projectId, userId),
		Promise.resolve().then(() => getDatabaseContextCatalog(projectFolder)),
		hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }),
		getProjectRowSecurity(projectId),
	]);
	const skillsAccess = await resolveSkillsAccess(projectId, effectiveAccess.skillsAccess);
	return {
		warehouseTableAccess: expandDatabaseAccess(effectiveAccess.databaseAccess, catalog),
		warehouseRowSecurity: resolveRowSecurityAccess(rowSecurity, effectiveAccess.rowPolicies, rowSecurityLicensed),
		docsContextAccess: { enforced: true, access: effectiveAccess.docsAccess },
		filesContextAccess: { enforced: true, access: effectiveAccess.filesAccess },
		mcpAccess: effectiveAccess.mcpAccess,
		skillsAccess,
		userGroupFeatures: effectiveAccess.features,
		userRulesGroupAccess: { enforced: true, groupNames: effectiveAccess.groupNames },
		preloadedSkillNames: effectiveAccess.preloadedSkills,
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
