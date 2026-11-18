import type { DBAutomation } from '../../db/abstractSchema';
import { getTools } from '../tools';
import type { AgentProfile } from './types';

const AUTOMATION_STEP_BUDGET = 20;

/** Runs an automation prompt unattended and delivers the answer through the automation's integration tools. */
export function automationAgent(
	automation: Pick<DBAutomation, 'mcpEnabled' | 'mcpServers'>,
	integrationTools: Record<string, unknown>,
): AgentProfile {
	return {
		source: 'automation',
		tools: ({ agentSettings, toolContext, webTools }) =>
			getTools(
				agentSettings,
				{ ...(webTools ?? {}), ...integrationTools },
				{
					mcpEnabled: automation.mcpEnabled,
					mcpServers: automation.mcpServers,
					mcpAccess: toolContext.mcpAccess,
					excludeFollowUps: true,
					semanticLayerMode: toolContext.semanticLayerMode,
				},
			),
		supportsCustomCharts: false,
		maxSteps: AUTOMATION_STEP_BUDGET,
		usageCategory: 'automation',
	};
}
