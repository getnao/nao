import { hasToolCall, stepCountIs, type StepResult, type StopCondition } from 'ai';

import type { AgentTools } from '../types/chat';

/**
 * Backstop on the number of model calls per interactive turn, for loops the stuck detectors below
 * cannot see (a model that keeps succeeding without ever finishing). The AI SDK only applies its
 * own default (`stepCountIs(20)`) when no `stopWhen` is given, so without it the loop is unbounded.
 */
export const INTERACTIVE_MAX_STEPS = 100;

export const MAX_CONSECUTIVE_INVALID_STEPS = 3;

export const MAX_TOOL_ERRORS_PER_TURN = 10;

export const MAX_IDENTICAL_TOOL_CALLS_PER_TURN = 3;

export const MAX_CONSECUTIVE_IDENTICAL_STEPS = 3;

/** Tools whose output can change within a turn (after a `write` or `str_replace`), so repeating a call is legitimate. */
const REPEATABLE_TOOLS = new Set(['read', 'list', 'grep', 'search']);

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
 * feeds each validation error back to the model and continues to the next step.
 */
export const hasRepeatedInvalidToolCalls: StopCondition<AgentTools> = ({ steps }) => {
	const tail = steps.slice(-MAX_CONSECUTIVE_INVALID_STEPS);
	if (tail.length < MAX_CONSECUTIVE_INVALID_STEPS) {
		return false;
	}
	return tail.every(hasOnlyInvalidToolCalls);
};

/** Ends the turn when a single tool has failed too many times, consecutively or not. */
export const hasRepeatedToolErrors: StopCondition<AgentTools> = ({ steps }) => {
	const toolNames = steps.flatMap((step) =>
		step.content.flatMap((part) => (part.type === 'tool-error' ? [part.toolName] : [])),
	);
	return maxOccurrences(toolNames) >= MAX_TOOL_ERRORS_PER_TURN;
};

/** Ends the turn when the model calls the same tool with the exact same input again and again. */
export const hasRepeatedIdenticalToolCalls: StopCondition<AgentTools> = ({ steps }) => {
	const callKeys = steps.flatMap((step) =>
		step.toolCalls.flatMap((toolCall) =>
			toolCall && !REPEATABLE_TOOLS.has(toolCall.toolName)
				? [`${toolCall.toolName}:${JSON.stringify(toolCall.input)}`]
				: [],
		),
	);
	return maxOccurrences(callKeys) >= MAX_IDENTICAL_TOOL_CALLS_PER_TURN;
};

/**
 * Ends the turn when the model produces the exact same step (text and tool calls) several times in
 * a row. Text alone is not enough: models often repeat a short progress line while calling
 * different tools.
 */
export const hasRepeatedSteps: StopCondition<AgentTools> = ({ steps }) => {
	const signatures = steps.slice(-MAX_CONSECUTIVE_IDENTICAL_STEPS).map(toStepSignature);
	if (signatures.length < MAX_CONSECUTIVE_IDENTICAL_STEPS) {
		return false;
	}
	return signatures.every((signature) => signature === signatures[0]);
};

export const interactiveStopConditions: StopCondition<AgentTools>[] = [
	hasFollowUpsWithText,
	hasToolCall('clarification'),
	hasRepeatedInvalidToolCalls,
	hasRepeatedToolErrors,
	hasRepeatedIdenticalToolCalls,
	hasRepeatedSteps,
	stepCountIs(INTERACTIVE_MAX_STEPS),
];

const callsFollowUps = (step: StepResult<AgentTools>): boolean => {
	return step.toolCalls.some((toolCall) => toolCall?.toolName === 'suggest_follow_ups');
};

const hasOnlyInvalidToolCalls = (step: StepResult<AgentTools>): boolean => {
	return step.toolCalls.length > 0 && step.toolCalls.every((toolCall) => toolCall?.invalid === true);
};

const toStepSignature = (step: StepResult<AgentTools>): string => {
	const toolCalls = step.toolCalls.map((toolCall) => [toolCall?.toolName, toolCall?.input]);
	return JSON.stringify([step.text.trim(), toolCalls]);
};

const maxOccurrences = (values: string[]): number => {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return Math.max(0, ...counts.values());
};
