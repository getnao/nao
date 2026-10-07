import { hasToolCall, stepCountIs, type StepResult, type StopCondition } from 'ai';

import type { AgentTools } from '../types/chat';

/**
 * Hard ceiling on the number of model calls per interactive turn. The AI SDK only applies its
 * own default (`stepCountIs(20)`) when no `stopWhen` is given; since interactive runs always
 * pass one, the loop has no bound at all without this entry.
 */
export const INTERACTIVE_MAX_STEPS = 40;

/**
 * Number of consecutive steps made only of invalid tool calls after which the turn ends.
 */
export const MAX_CONSECUTIVE_INVALID_STEPS = 3;

/**
 * Ends the turn once `suggest_follow_ups` is called alongside visible text. Some models call it
 * before writing their answer; letting the loop run on hides the stray call from them (it is
 * pruned from the next step's context) so they write the answer and call it again. A second
 * textless call ends the turn anyway so the loop cannot spin.
 */
export const hasFollowUpsWithText: StopCondition<AgentTools> = ({ steps }) => {
	const lastStep = steps.at(-1);
	if (!lastStep || !callsFollowUps(lastStep)) {
		return false;
	}
	const hasVisibleText = lastStep.text.trim().length > 0;
	const alreadyRetried = steps.slice(0, -1).some(callsFollowUps);
	return hasVisibleText || alreadyRetried;
};

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

export const interactiveStopConditions: StopCondition<AgentTools>[] = [
	hasFollowUpsWithText,
	hasToolCall('clarification'),
	hasRepeatedInvalidToolCalls,
	stepCountIs(INTERACTIVE_MAX_STEPS),
];

const callsFollowUps = (step: StepResult<AgentTools>): boolean => {
	return step.toolCalls.some((toolCall) => toolCall?.toolName === 'suggest_follow_ups');
};
