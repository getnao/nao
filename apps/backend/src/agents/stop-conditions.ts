import { hasToolCall, stepCountIs, type StopCondition } from 'ai';

import type { AgentTools } from '../types/chat';

/**
 * Hard ceiling on the number of model calls per interactive turn. The AI SDK only applies its
 * own default (`stepCountIs(20)`) when no `stopWhen` is given; since interactive runs always
 * pass one, the loop has no bound at all without this entry.
 */
export const INTERACTIVE_MAX_STEPS = 40;

/** Number of consecutive steps made only of invalid tool calls after which the turn ends. */
export const MAX_CONSECUTIVE_INVALID_STEPS = 3;

/**
 * Ends the turn when the model keeps emitting invalid tool calls (for instance tool calls with
 * empty arguments, which fail schema validation) without ever producing a valid one. The SDK
 * feeds each validation error back to the model and continues to the next step, so a model that
 * never recovers would otherwise loop until the process runs out of memory.
 */
export const hasRepeatedInvalidToolCalls: StopCondition<AgentTools> = ({ steps }) => {
	const tail = steps.slice(-MAX_CONSECUTIVE_INVALID_STEPS);
	if (tail.length < MAX_CONSECUTIVE_INVALID_STEPS) {
		return false;
	}
	return tail.every(
		(step) => step.toolCalls.length > 0 && step.toolCalls.every((toolCall) => toolCall?.invalid === true),
	);
};

/** Stop conditions of an interactive turn (chat, MCP sub-agent, messaging integrations). */
export const interactiveStopConditions: StopCondition<AgentTools>[] = [
	hasToolCall('suggest_follow_ups'),
	hasToolCall('clarification'),
	hasRepeatedInvalidToolCalls,
	stepCountIs(INTERACTIVE_MAX_STEPS),
];
