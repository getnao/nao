import type { DBProject, NewProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import { recordOrganizationSetupCandidate } from './credit-grant.service';
import { registerEnvLlmConfigs } from './env-llm-config.service';
import { getProjectReadiness } from './project-readiness.service';

export async function createProject(project: NewProject): Promise<DBProject> {
	const created = await projectQueries.createProject(project);
	await registerEnvLlmConfigs(created.id);
	await projectChanged(created.id);
	return created;
}

export async function touchProjectUpdatedAt(projectId: string): Promise<void> {
	await projectQueries.touchProjectUpdatedAt(projectId);
	await projectChanged(projectId);
}

export async function recordProjectDeployment(projectId: string, deployedAt = new Date()): Promise<void> {
	await projectQueries.recordProjectDeployment(projectId, deployedAt);
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
	return (await getProjectReadiness(project)).missingEnvVars;
}

async function projectChanged(projectId: string): Promise<void> {
	await recordOrganizationSetupCandidate(projectId);
}
