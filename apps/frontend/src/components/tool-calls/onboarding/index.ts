import { GenerateOnboardingRulesToolCall } from './generate-onboarding-rules';
import { OnboardingAgentPromptToolCall } from './onboarding-agent-prompt';
import { OnboardingCommandToolCall } from './onboarding-command';
import { RequestWarehouseCredentialsToolCall } from './request-warehouse-credentials';
import { RequestWarehouseSelectionToolCall } from './request-warehouse-selection';
import { RestartOnboardingToolCall } from './restart-onboarding';
import { RetryWarehouseSetupToolCall, WaitForWarehouseSetupToolCall } from './warehouse-setup-status';
import type { ComponentType } from 'react';
import type { OnboardingCardTool } from './card-tools';
import type { ToolCallComponentProps } from '..';

export const onboardingToolComponents: {
	[TToolName in OnboardingCardTool]: ComponentType<ToolCallComponentProps<TToolName>>;
} = {
	generate_onboarding_rules: GenerateOnboardingRulesToolCall,
	onboarding_agent_prompt: OnboardingAgentPromptToolCall,
	onboarding_command: OnboardingCommandToolCall,
	request_warehouse_credentials: RequestWarehouseCredentialsToolCall,
	request_warehouse_selection: RequestWarehouseSelectionToolCall,
	restart_onboarding: RestartOnboardingToolCall,
	retry_warehouse_setup: RetryWarehouseSetupToolCall,
	wait_for_warehouse_setup: WaitForWarehouseSetupToolCall,
};
