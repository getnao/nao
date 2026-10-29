import type { onboardingProgress } from '@nao/shared/tools';
import type { StepResult } from 'ai';

import { renderOnboardingSystemPrompt } from '../../components/ai/onboarding-system-prompt';
import { getOnboardingWarehouseState } from '../../services/warehouse-provisioning';
import type { AgentTools } from '../../types/chat';
import { getTools } from '../tools';
import type { AgentProfile, AgentStepTools } from './types';

const ONBOARDING_TOOLS = [
	'clarification',
	'onboarding_agent_prompt',
	'onboarding_command',
	'onboarding_progress',
	'request_warehouse_credentials',
	'request_warehouse_selection',
	'wait_for_warehouse_setup',
	'retry_warehouse_setup',
	'generate_onboarding_rules',
	'restart_onboarding',
];

const WAREHOUSE_REQUEST_STEP_TOOLS: AgentStepTools = {
	toolChoice: 'required',
	activeTools: ['request_warehouse_selection', 'request_warehouse_credentials'],
};

/** Guides a new user through connecting their warehouse and generating their first context. */
export const onboardingAgent: AgentProfile = {
	source: 'onboarding',
	tools: ({ agentSettings }) =>
		getTools(agentSettings, {}, { onboarding: true, builtinToolAllowlist: ONBOARDING_TOOLS }),
	stepTools: getOnboardingStepTools,
	systemPrompt: async ({ chat }) =>
		renderOnboardingSystemPrompt(await getOnboardingWarehouseState(chat.userId, chat.id)),
};

/**
 * Starting the database flow must be followed by the warehouse selection or the connection form.
 * Models tend to announce the form in a text-only step instead, which ends the turn without it.
 */
export function getOnboardingStepTools(steps: StepResult<AgentTools>[]): AgentStepTools | undefined {
	return steps.at(-1)?.toolCalls.some(isDatabaseFlowStart) ? WAREHOUSE_REQUEST_STEP_TOOLS : undefined;
}

function isDatabaseFlowStart(toolCall: StepResult<AgentTools>['toolCalls'][number]): boolean {
	if (toolCall?.toolName !== 'onboarding_progress' || toolCall.invalid) {
		return false;
	}
	const { flow, step } = toolCall.input as onboardingProgress.Input;
	return flow === 'database' && step === 0;
}
