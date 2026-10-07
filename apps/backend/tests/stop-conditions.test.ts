import type { StepResult } from 'ai';
import { describe, expect, it } from 'vitest';

import { hasRepeatedInvalidToolCalls, MAX_CONSECUTIVE_INVALID_STEPS } from '../src/agents/stop-conditions';
import type { AgentTools } from '../src/types/chat';

type Step = StepResult<AgentTools>;

const step = (toolCalls: Array<{ invalid?: boolean }>): Step =>
	({
		text: '',
		toolCalls: toolCalls.map((c, i) => ({ toolCallId: `c${i}`, toolName: 'list', input: {}, ...c })),
	}) as unknown as Step;

const invalidStep = () => step([{ invalid: true }]);
const validStep = () => step([{ invalid: false }]);
const textStep = () => step([]);

describe('hasRepeatedInvalidToolCalls', () => {
	it('does not stop before the threshold is reached', () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_INVALID_STEPS - 1 }, invalidStep);
		expect(hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('stops after N consecutive steps made only of invalid tool calls', () => {
		const steps = Array.from({ length: MAX_CONSECUTIVE_INVALID_STEPS }, invalidStep);
		expect(hasRepeatedInvalidToolCalls({ steps })).toBe(true);
	});

	it('keeps going when a valid tool call interrupts the series', () => {
		const steps = [invalidStep(), validStep(), invalidStep(), invalidStep()];
		expect(hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('ignores steps without tool calls', () => {
		const steps = [invalidStep(), invalidStep(), textStep()];
		expect(hasRepeatedInvalidToolCalls({ steps })).toBe(false);
	});

	it('only looks at the tail of the steps', () => {
		const steps = [validStep(), validStep(), invalidStep(), invalidStep(), invalidStep()];
		expect(hasRepeatedInvalidToolCalls({ steps })).toBe(true);
	});
});
