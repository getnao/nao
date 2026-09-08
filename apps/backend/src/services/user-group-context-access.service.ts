import { getDatabaseContextCatalog } from '../agents/user-rules';
import { getUserRoleInProject } from '../queries/project.queries';
import { resolveEffectiveUserGroupAccess } from '../queries/user-group.queries';
import { HandlerError } from '../utils/error';
import { expandDatabaseAccess, type WarehouseTableAccess } from './context-access';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export * from './context-access';

export async function resolveWarehouseTableAccess(
	projectId: string,
	userId: string,
	projectFolder: string,
): Promise<WarehouseTableAccess> {
	if (!(await getUserRoleInProject(projectId, userId))) {
		throw new HandlerError('FORBIDDEN', 'You do not have access to this project.');
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups))) {
		return { enforced: false };
	}

	const [effectiveAccess, catalog] = await Promise.all([
		resolveEffectiveUserGroupAccess(projectId, userId),
		Promise.resolve().then(() => getDatabaseContextCatalog(projectFolder)),
	]);

	return expandDatabaseAccess(effectiveAccess.databaseAccess, catalog);
}
