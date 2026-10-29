import generateOnboardingRules from './generate-onboarding-rules';
import onboardingAgentPrompt from './onboarding-agent-prompt';
import onboardingCommand from './onboarding-command';
import onboardingProgress from './onboarding-progress';
import requestWarehouseCredentials from './request-warehouse-credentials';
import requestWarehouseSelection from './request-warehouse-selection';
import restartOnboarding from './restart-onboarding';
import retryWarehouseSetup from './retry-warehouse-setup';
import waitForWarehouseSetup from './wait-for-warehouse-setup';

export const onboardingTools = {
	onboarding_agent_prompt: onboardingAgentPrompt,
	onboarding_command: onboardingCommand,
	onboarding_progress: onboardingProgress,
	request_warehouse_credentials: requestWarehouseCredentials,
	request_warehouse_selection: requestWarehouseSelection,
	wait_for_warehouse_setup: waitForWarehouseSetup,
	retry_warehouse_setup: retryWarehouseSetup,
	generate_onboarding_rules: generateOnboardingRules,
	restart_onboarding: restartOnboarding,
};

/** Tools that hand control back to the user: they wait for a choice or a form, or move them to a new conversation. */
export const ONBOARDING_TURN_ENDING_TOOLS: (keyof typeof onboardingTools)[] = [
	'request_warehouse_selection',
	'request_warehouse_credentials',
	'restart_onboarding',
];
