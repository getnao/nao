import { type StepResult, streamText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
	hasFollowUpsWithText,
	hasRepeatedIdenticalToolCalls,
	hasRepeatedInvalidToolCalls,
	hasRepeatedSteps,
	hasRepeatedToolErrors,
	interactiveStopConditions,
	MAX_CONSECUTIVE_IDENTICAL_STEPS,
	MAX_CONSECUTIVE_INVALID_STEPS,
	MAX_IDENTICAL_TOOL_CALLS_PER_TURN,
	MAX_TOOL_ERRORS_PER_TURN,
} from '../src/agents/stop-conditions';
import type { AgentTools } from '../src/types/chat';

const createStep = (text: string, toolNames: string[]): StepResult<AgentTools> =>
	({
		text,
		content: [],
		toolCalls: toolNames.map((toolName) => ({ toolName, toolCallId: `${toolName}-call`, input: {} })),
	}) as unknown as StepResult<AgentTools>;

const createInvalidStep = (invalid: boolean): StepResult<AgentTools> =>
	({
		text: '',
		content: [],
		toolCalls: [{ toolName: 'list', toolCallId: 'list-call', input: {}, invalid }],
	}) as unknown as StepResult<AgentTools>;

const createCallStep = (toolName: string, input: unknown): StepResult<AgentTools> =>
	({
		text: '',
		content: [],
		toolCalls: [{ toolName, toolCallId: `${toolName}-call`, input }],
	}) as unknown as StepResult<AgentTools>;

const createErrorStep = (toolName: string): StepResult<AgentTools> =>
	({
		text: '',
		content: [{ type: 'tool-error', toolName, toolCallId: `${toolName}-call`, input: {}, error: 'failed' }],
		toolCalls: [],
	}) as unknown as StepResult<AgentTools>;

const repeat = (count: number, createStepAt: (index: number) => StepResult<AgentTools>): StepResult<AgentTools>[] => {
	return Array.from({ length: count }, (_, index) => createStepAt(index));
};

describe('interactiveStopConditions', () => {
	it('ends a turn where every query fails instead of looping', async () => {
		const failingSql = tool({
			description: 'sql',
			inputSchema: z.object({ sql_query: z.string() }),
			execute: async () => {
				throw new Error('Table not found');
			},
		});
		const result = streamText({
			model: alwaysQueryingModel(),
			tools: { execute_sql: failingSql },
			stopWhen: interactiveStopConditions,
			prompt: 'go',
		});
		await result.consumeStream();

		expect((await result.steps).length).toBe(MAX_TOOL_ERRORS_PER_TURN);
	});
});

describe('hasFollowUpsWithText', () => {
	it('stops when suggest_follow_ups comes with visible text', async () => {
		const steps = [createStep('Revenue grew 12% over the quarter.', ['suggest_follow_ups'])];

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

describe('hasRepeatedToolErrors', () => {
	it('stops once a tool has failed too many times in the turn, even with successes in between', async () => {
		const steps = repeat(MAX_TOOL_ERRORS_PER_TURN * 2, (index) =>
			index % 2 === 0 ? createErrorStep('execute_sql') : createCallStep('read', { file_path: `${index}.md` }),
		);

		expect(await hasRepeatedToolErrors({ steps })).toBe(true);
	});

	it('keeps going below the threshold', async () => {
		const steps = repeat(MAX_TOOL_ERRORS_PER_TURN - 1, () => createErrorStep('execute_sql'));

		expect(await hasRepeatedToolErrors({ steps })).toBe(false);
	});

	it('counts errors per tool', async () => {
		const steps = repeat(MAX_TOOL_ERRORS_PER_TURN, (index) =>
			createErrorStep(index % 2 === 0 ? 'execute_sql' : 'story'),
		);

		expect(await hasRepeatedToolErrors({ steps })).toBe(false);
	});
});

describe('hasRepeatedIdenticalToolCalls', () => {
	it('stops when the same call is repeated in the turn', async () => {
		const steps = repeat(MAX_IDENTICAL_TOOL_CALLS_PER_TURN, () =>
			createCallStep('execute_sql', { sql_query: 'SELECT 1' }),
		);

		expect(await hasRepeatedIdenticalToolCalls({ steps })).toBe(true);
	});

	it('keeps going when the input differs', async () => {
		const steps = repeat(MAX_IDENTICAL_TOOL_CALLS_PER_TURN, (index) =>
			createCallStep('execute_sql', { sql_query: `SELECT ${index}` }),
		);

		expect(await hasRepeatedIdenticalToolCalls({ steps })).toBe(false);
	});

	it('ignores tools whose output can change within the turn', async () => {
		const steps = repeat(MAX_IDENTICAL_TOOL_CALLS_PER_TURN, () =>
			createCallStep('read', { file_path: 'RULES.md' }),
		);

		expect(await hasRepeatedIdenticalToolCalls({ steps })).toBe(false);
	});
});

describe('hasRepeatedSteps', () => {
	it('stops when the same text and tool calls repeat step after step', async () => {
		const steps = repeat(MAX_CONSECUTIVE_IDENTICAL_STEPS, () => createStep('Let me check the orders.', ['read']));

		expect(await hasRepeatedSteps({ steps })).toBe(true);
	});

	it('keeps going when the same progress text comes with different tool calls', async () => {
		const steps = repeat(MAX_CONSECUTIVE_IDENTICAL_STEPS, (index) =>
			createStep('Let me check.', [index % 2 === 0 ? 'execute_sql' : 'read']),
		);

		expect(await hasRepeatedSteps({ steps })).toBe(false);
	});

	it('only looks at consecutive steps', async () => {
		const steps = [
			createStep('Let me check the orders.', ['read']),
			createStep('Let me check the orders.', ['read']),
			createStep('Revenue grew 12%.', ['execute_sql']),
			createStep('Let me check the orders.', ['read']),
		];

		expect(await hasRepeatedSteps({ steps })).toBe(false);
	});
});

/** A model that answers every step with a new `execute_sql` call, like one retrying failing queries forever. */
function alwaysQueryingModel() {
	let callIndex = 0;
	return new MockLanguageModelV3({
		doStream: async () => {
			callIndex += 1;
			const toolCallId = `call_${callIndex}`;
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: 'stream-start', warnings: [] });
						controller.enqueue({
							type: 'tool-call',
							toolCallId,
							toolName: 'execute_sql',
							input: JSON.stringify({ sql_query: `SELECT ${callIndex}` }),
						});
						controller.enqueue({
							type: 'finish',
							finishReason: { unified: 'tool-calls', raw: 'tool_use' },
							usage: {
								inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
								outputTokens: { total: 1, text: 1, reasoning: 0 },
							},
						});
						controller.close();
					},
				}),
			};
		},
	});
}
