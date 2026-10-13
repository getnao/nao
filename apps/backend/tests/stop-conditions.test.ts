import type { StepResult } from 'ai';
import { describe, expect, it } from 'vitest';

import { hasRepeatedInvalidToolCalls, MAX_CONSECUTIVE_INVALID_STEPS } from '../src/agents/stop-conditions';
import type { AgentTools } from '../src/types/chat';

const createStep = (text: string, toolNames: string[]): StepResult<AgentTools> =>
	({
		text,
		toolCalls: toolNames.map((toolName) => ({ toolName, toolCallId: `${toolName}-call`, input: {} })),
	}) as unknown as StepResult<AgentTools>;

const createInvalidStep = (invalid: boolean): StepResult<AgentTools> =>
	({
		text: '',
		toolCalls: [{ toolName: 'list', toolCallId: 'list-call', input: {}, invalid }],
	}) as unknown as StepResult<AgentTools>;

describe('hasRepeatedInvalidToolCalls', () => {
	it('does not stop before the threshold is reached', async () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_INVALID_STEPS - 1 }, () => createInvalidStep(true));

		expect(await hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('stops after N consecutive steps made only of invalid tool calls', async () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_INVALID_STEPS }, () => createInvalidStep(true));

		expect(await hasRepeatedInvalidToolCalls({ steps })).toBe(true);
	});

	it('keeps going when a valid tool call interrupts the series', async () => {
		const steps = [
			createInvalidStep(true),
			createInvalidStep(false),
			createInvalidStep(true),
			createInvalidStep(true),
		];

		expect(await hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('ignores steps without tool calls', async () => {
		const steps = [createInvalidStep(true), createInvalidStep(true), createStep('Done.', [])];

		expect(await hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('only looks at the tail of the steps', async () => {
		const steps = [
			createStep('', ['execute_sql']),
			createInvalidStep(true),
			createInvalidStep(true),
			createInvalidStep(true),
		];

		expect(await hasRepeatedInvalidToolCalls({ steps })).toBe(true);
	});
});
