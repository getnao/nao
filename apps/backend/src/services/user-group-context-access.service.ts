import {
	type DocsContextAccess,
	type ProjectRowSecurity,
	resolveWarehouseRowSecurity,
	type UserGroupFeature,
	type UserGroupRowPolicies,
	type WarehouseRowSecurity,
} from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { getUserRoleInProject } from '../queries/project.queries';
import { getProjectRowSecurity } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { expandDatabaseAccess, type WarehouseTableAccess } from './context-access';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { resolveAvailableUserGroupAccess } from './user-group-availability.service';

export * from './context-access';

export type ResolvedDocsContextAccess = { enforced: false } | { enforced: true; access: DocsContextAccess };

export async function resolveProjectContextAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<{
	warehouseTableAccess: WarehouseTableAccess;
	warehouseRowSecurity: WarehouseRowSecurity;
	docsContextAccess: ResolvedDocsContextAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
}> {
	if (!(await getUserRoleInProject(projectId, userId))) {
		throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
	}

	const [effectiveAccess, catalog, rowSecurityLicensed, rowSecurity] = await Promise.all([
		resolveAvailableUserGroupAccess(projectId, userId),
		Promise.resolve().then(() => getDatabaseContextCatalog(projectFolder)),
		hasFeature(LICENSE_FEATURES.rowLevelSecurity),
		getProjectRowSecurity(projectId),
	]);
	return {
		warehouseTableAccess: expandDatabaseAccess(effectiveAccess.databaseAccess, catalog),
		warehouseRowSecurity: resolveRowSecurityAccess(rowSecurity, effectiveAccess.rowPolicies, rowSecurityLicensed),
		docsContextAccess: { enforced: true, access: effectiveAccess.docsAccess },
		userGroupFeatures: effectiveAccess.features,
		userRulesGroupAccess: { enforced: true, groupNames: effectiveAccess.groupNames },
	};
}

export async function resolveWarehouseTableAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<WarehouseTableAccess> {
	return (await resolveProjectContextAccess(projectId, userId, projectFolder)).warehouseTableAccess;
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
