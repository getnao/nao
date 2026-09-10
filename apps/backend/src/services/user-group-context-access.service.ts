import type { DocsContextAccess, UserGroupFeature } from '@nao/shared';
import { USER_GROUP_FEATURES } from '@nao/shared';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { getUserRoleInProject } from '../queries/project.queries';
import { resolveEffectiveUserGroupAccess } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { expandDatabaseAccess, type WarehouseTableAccess } from './context-access';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export * from './context-access';

export type ResolvedDocsContextAccess = { enforced: false } | { enforced: true; access: DocsContextAccess };

export async function resolveProjectContextAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<{
	warehouseTableAccess: WarehouseTableAccess;
	docsContextAccess: ResolvedDocsContextAccess;
	userGroupFeatures: UserGroupFeature[];
	userRulesGroupAccess: UserRulesGroupAccess;
}> {
	if (!(await getUserRoleInProject(projectId, userId))) {
		throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups))) {
		return {
			warehouseTableAccess: { enforced: false },
			docsContextAccess: { enforced: false },
			userGroupFeatures: [...USER_GROUP_FEATURES],
			userRulesGroupAccess: { enforced: false },
		};
	}

	const [effectiveAccess, catalog] = await Promise.all([
		resolveEffectiveUserGroupAccess(projectId, userId),
		Promise.resolve().then(() => getDatabaseContextCatalog(projectFolder)),
	]);
	return {
		warehouseTableAccess: expandDatabaseAccess(effectiveAccess.databaseAccess, catalog),
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
