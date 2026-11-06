import { getTools } from '../tools';
import type { AgentProfile } from './types';

const ANALYSIS_STEP_BUDGET = 40;
const CONTEXT_DISCOVERY_TOOLS = ['read', 'grep', 'list', 'search'];

/** Reviews past chats to record recommendations on the project context; it reads the context but never queries the warehouse. */
export function contextRecommendationsAgent(
	systemPrompt: string,
	recommendationTools: Record<string, unknown>,
): AgentProfile {
	return {
		source: 'contextRecommendations',
		tools: ({ agentSettings }) =>
			getTools(agentSettings, recommendationTools, {
				excludeFollowUps: true,
				builtinToolAllowlist: CONTEXT_DISCOVERY_TOOLS,
			}),
		systemPrompt: () => systemPrompt,
		maxSteps: ANALYSIS_STEP_BUDGET,
		usageCategory: 'recommendation',
	};
}
