import type { DBProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import { extractRequiredSyncEnvVars } from '../utils/nao-config';
import { getProjectWarehouseEnvVars, getProjectWarehouseEnvVarsByIdentity } from './warehouse-credentials';

export async function getProjectRuntimeEnvVars(projectId: string): Promise<Record<string, string>> {
	const [projectEnvVars, warehouseEnvVars] = await Promise.all([
		projectQueries.getEnvVars(projectId),
		getProjectWarehouseEnvVars(projectId),
	]);

	return {
		...projectEnvVars,
		...warehouseEnvVars,
	};
}

async function getOwnedProjectSyncEnvVars(
	project: Pick<DBProject, 'id' | 'orgId'>,
	userId: string,
): Promise<Record<string, string>> {
	const role = await projectQueries.getUserRoleInProject(project.id, userId);
	if (role !== 'admin') {
		throw new Error('Only a project admin can load sync credentials.');
	}
	const [projectEnvVars, warehouseEnvVars] = await Promise.all([
		projectQueries.getProjectEnvVarsByIdentity(project.id, project.orgId),
		getProjectWarehouseEnvVarsByIdentity(project.id, project.orgId),
	]);
	if (!projectEnvVars) {
		throw new Error('Project identity changed before sync credentials could be loaded.');
	}

	return {
		...projectEnvVars,
		...(warehouseEnvVars ?? {}),
	};
}

export async function getProjectSyncEnvVars(
	project: Pick<DBProject, 'id' | 'orgId'>,
	userId: string,
	projectPath: string,
): Promise<Record<string, string>> {
	const envVars = await getOwnedProjectSyncEnvVars(project, userId);
	const requiredNames = new Set(extractRequiredSyncEnvVars(projectPath));
	return Object.fromEntries(Object.entries(envVars).filter(([name]) => requiredNames.has(name)));
}
