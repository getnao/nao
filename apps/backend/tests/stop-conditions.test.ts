import type { StepResult } from 'ai';
import { describe, expect, it } from 'vitest';

import {
	hasFollowUpsWithText,
	hasRepeatedInvalidToolCalls,
	MAX_CONSECUTIVE_INVALID_STEPS,
} from '../src/agents/stop-conditions';
import type { AgentTools } from '../src/types/chat';

const createStep = (text: string, toolNames: string[]): StepResult<AgentTools> =>
	({
		text,
		toolCalls: toolNames.map((toolName) => ({ toolName, toolCallId: `${toolName}-call`, input: {} })),
	}) as unknown as StepResult<AgentTools>;

describe('hasFollowUpsWithText', () => {
	it('stops when suggest_follow_ups comes with visible text', async () => {
		const steps = [createStep('Revenue grew 12%. Pick a suggestion below.', ['suggest_follow_ups'])];

		expect(await hasFollowUpsWithText({ steps })).toBe(true);
	});

	it('continues when suggest_follow_ups is called before any text', async () => {
		const steps = [createStep('', ['execute_sql']), createStep('   ', ['suggest_follow_ups'])];

		expect(await hasFollowUpsWithText({ steps })).toBe(false);
	});

	it('stops a second textless suggest_follow_ups call', async () => {
		const steps = [createStep('', ['suggest_follow_ups']), createStep('', ['suggest_follow_ups'])];

		expect(await hasFollowUpsWithText({ steps })).toBe(true);
	});

	it('ignores steps that do not call suggest_follow_ups', async () => {
		const steps = [createStep('Looking at the orders table.', ['execute_sql'])];

		expect(await hasFollowUpsWithText({ steps })).toBe(false);
	});

	it('ignores earlier text when the follow-ups call is in a later step', async () => {
		const steps = [createStep('Let me check.', ['execute_sql']), createStep('', ['suggest_follow_ups'])];

		expect(await hasFollowUpsWithText({ steps })).toBe(false);
	});
});

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
