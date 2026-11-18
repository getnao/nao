/* @license Enterprise */

import * as projectQueries from '../queries/project.queries';
import type { AgentSettings } from '../types/agent-settings';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export async function resolveExcludedColumnEnforcementForProject(projectId: string): Promise<boolean> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	return resolveExcludedColumnEnforcement(projectId, agentSettings);
}

export async function resolveExcludedColumnEnforcement(
	projectId: string,
	agentSettings: AgentSettings | null,
): Promise<boolean> {
	return (
		(await hasFeature(LICENSE_FEATURES.excludeColumns, { projectId })) &&
		(agentSettings?.sql?.enforceExcludedColumns ?? true)
	);
}
