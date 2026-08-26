import type { AgentSettings } from '../types/agent-settings';
import { hasFeature, LICENSE_FEATURES } from './license.service';

export async function resolveExcludedColumnEnforcement(agentSettings: AgentSettings | null): Promise<boolean> {
	return (await hasFeature(LICENSE_FEATURES.excludeColumns)) && (agentSettings?.sql?.enforceExcludedColumns ?? true);
}
