import { renderOnboardingSystemPrompt } from '../../components/ai/onboarding-system-prompt';
import { getOnboardingWarehouseState } from '../../services/onboarding/warehouse-provisioning';
import { getTools } from '../tools';
import { ONBOARDING_TURN_ENDING_TOOLS, onboardingTools } from '../tools/onboarding';
import type { AgentProfile } from './types';

/** Guides a new user through connecting their warehouse and generating their first context. */
export const onboardingAgent: AgentProfile = {
	source: 'onboarding',
	tools: ({ agentSettings }) => getTools(agentSettings, onboardingTools, { builtinToolAllowlist: ['clarification'] }),
	turnEndingTools: ONBOARDING_TURN_ENDING_TOOLS,
	systemPrompt: async ({ chat }) =>
		renderOnboardingSystemPrompt(await getOnboardingWarehouseState(chat.userId, chat.id)),
};
