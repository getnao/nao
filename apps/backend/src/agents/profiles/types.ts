import type { StepResult, ToolChoice } from 'ai';

import type { AgentChat, AgentToolsResolver } from '../../services/agent';
import type { AgentTools, MessageSource } from '../../types/chat';
import type { ManagedAiUsageCategory } from '../../types/managed-ai-usage';
import type { Provider } from '../../types/messaging-provider';

export interface AgentStepTools {
	toolChoice?: ToolChoice<AgentTools>;
	activeTools?: (keyof AgentTools)[];
}

/**
 * A profile is the flavour of an agent run: what it is for, the tools it may call and how its
 * prompt is built. The agent service runs every profile through the same loop.
 */
export interface AgentProfile {
	/** Recorded on the run's messages and analytics events. */
	source: MessageSource;
	tools: AgentToolsResolver;
	/** Restricts the tools of the next step, for steps of the profile's flow that must end with a given tool call. */
	stepTools?: (steps: StepResult<AgentTools>[]) => AgentStepTools | undefined;
	/** Replaces the project system prompt (RULES.md, memories, connections) for runs with a dedicated purpose. */
	systemPrompt?: (context: { timezone?: string; chat: AgentChat }) => string | Promise<string>;
	/** Appended to the project system prompt. */
	promptAppendix?: string;
	/** Chat app the answer is posted to, which adapts the prompt to its formatting. */
	messagingProvider?: Provider;
	/** Runs `execute_sql` over nao's own app-database views instead of the warehouse. */
	queriesAppDatabase?: boolean;
	/** Project-defined charts only render in the web client. */
	supportsCustomCharts?: boolean;
	/** Ends non-interactive runs after this many steps instead of when the agent suggests follow-ups. */
	maxSteps?: number;
	usageCategory?: ManagedAiUsageCategory;
}
