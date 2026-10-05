import { hasToolCall, type StepResult, type StopCondition } from 'ai';

import type { AgentTools } from '../types/chat';

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

export const interactiveStopConditions: StopCondition<AgentTools>[] = [
	hasFollowUpsWithText,
	hasToolCall('clarification'),
];

const callsFollowUps = (step: StepResult<AgentTools>): boolean => {
	return step.toolCalls.some((toolCall) => toolCall?.toolName === 'suggest_follow_ups');
};
