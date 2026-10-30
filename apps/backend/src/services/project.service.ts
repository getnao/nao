import type { DBProject, NewProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import { recordOrganizationSetupCandidate } from './credit-grant.service';
import { assessProjectReadiness } from './project-readiness.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

export async function createProject(project: NewProject, actingUserId?: string): Promise<DBProject> {
	const created = await projectQueries.createProject(project, undefined, actingUserId);
	await projectChanged(created.id);
	return created;
}

export async function touchProjectUpdatedAt(projectId: string): Promise<void> {
	await projectQueries.touchProjectUpdatedAt(projectId);
	await projectChanged(projectId);
}

export async function updateProjectEnvVars(projectId: string, envVars: Record<string, string>): Promise<void> {
	await projectQueries.updateEnvVars(projectId, envVars);
	await projectChanged(projectId);
}

export async function reconcileProjectReadiness(projectId: string): Promise<void> {
	await projectChanged(projectId);
}

export async function getMissingProjectEnvVars(project: Pick<DBProject, 'id' | 'path'>): Promise<string[]> {
	const envVars = await getProjectRuntimeEnvVars(project.id);
	return assessProjectReadiness({ path: project.path, envVars }).missingEnvVars;
}

async function projectChanged(projectId: string): Promise<void> {
	await recordOrganizationSetupCandidate(projectId);
}
