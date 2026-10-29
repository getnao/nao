import type { StepResult } from 'ai';
import { describe, expect, it } from 'vitest';

import { getOnboardingStepTools } from '../src/agents/profiles/onboarding';
import type { AgentTools } from '../src/types/chat';

const createStep = (toolCalls: { toolName: string; input: unknown; invalid?: boolean }[]): StepResult<AgentTools> =>
	({
		text: '',
		content: [],
		toolCalls: toolCalls.map((toolCall) => ({ ...toolCall, toolCallId: `${toolCall.toolName}-call` })),
	}) as unknown as StepResult<AgentTools>;

const startDatabaseFlow = { toolName: 'onboarding_progress', input: { flow: 'database', step: 0 } };

describe('getOnboardingStepTools', () => {
	it('requires the warehouse selection or the connection form right after the database flow starts', () => {
		expect(getOnboardingStepTools([createStep([startDatabaseFlow])])).toEqual({
			toolChoice: 'required',
			activeTools: ['request_warehouse_selection', 'request_warehouse_credentials'],
		});
	});

	it.each([
		{ name: 'no step yet', steps: [] },
		{ name: 'a text-only step', steps: [createStep([])] },
		{
			name: 'a later database step',
			steps: [createStep([{ toolName: 'onboarding_progress', input: { flow: 'database', step: 1 } }])],
		},
		{
			name: 'another flow',
			steps: [createStep([{ toolName: 'onboarding_progress', input: { flow: 'github', step: 0 } }])],
		},
		{ name: 'an invalid progress call', steps: [createStep([{ ...startDatabaseFlow, invalid: true }])] },
		{ name: 'an earlier database flow start', steps: [createStep([startDatabaseFlow]), createStep([])] },
	])('leaves the tools unrestricted after $name', ({ steps }) => {
		expect(getOnboardingStepTools(steps)).toBeUndefined();
	});
});
