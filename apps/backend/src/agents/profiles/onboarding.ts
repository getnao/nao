import { renderOnboardingSystemPrompt } from '../../components/ai/onboarding-system-prompt';
import { getTools } from '../tools';
import type { AgentProfile } from './types';

const ONBOARDING_TOOLS = [
	'clarification',
	'onboarding_agent_prompt',
	'onboarding_command',
	'onboarding_progress',
	'request_warehouse_credentials',
	'request_warehouse_selection',
	'generate_onboarding_rules',
];

/** Guides a new user through connecting their warehouse and generating their first context. */
export const onboardingAgent: AgentProfile = {
	source: 'onboarding',
	tools: ({ agentSettings }) =>
		getTools(agentSettings, {}, { onboarding: true, builtinToolAllowlist: ONBOARDING_TOOLS }),
	systemPrompt: () => renderOnboardingSystemPrompt(),
};
