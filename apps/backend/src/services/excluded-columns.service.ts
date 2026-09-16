/* @license Enterprise */

import * as projectQueries from '../queries/project.queries';
import type { AgentSettings } from '../types/agent-settings';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export async function resolveExcludedColumnEnforcementForProject(projectId: string): Promise<boolean> {
	const agentSettings = await projectQueries.getAgentSettings(projectId);
	return resolveExcludedColumnEnforcement(agentSettings);
}

export async function resolveExcludedColumnEnforcement(agentSettings: AgentSettings | null): Promise<boolean> {
	return (await hasFeature(LICENSE_FEATURES.excludeColumns)) && (agentSettings?.sql?.enforceExcludedColumns ?? true);
}
