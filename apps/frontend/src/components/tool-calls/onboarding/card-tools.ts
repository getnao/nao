import type { StaticToolName } from '@nao/backend/chat';

/** Onboarding tools shown as cards in the conversation, so they never collapse into a tool group. */
export const ONBOARDING_CARD_TOOLS = [
	'generate_onboarding_rules',
	'onboarding_agent_prompt',
	'onboarding_command',
	'request_warehouse_credentials',
	'request_warehouse_selection',
	'restart_onboarding',
	'retry_warehouse_setup',
	'wait_for_warehouse_setup',
] as const satisfies readonly StaticToolName[];

export type OnboardingCardTool = (typeof ONBOARDING_CARD_TOOLS)[number];
