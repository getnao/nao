import { beforeEach, describe, expect, it, vi } from 'vitest';

import { quickAnswer } from '../../src/services/quick-answer-flow';
import type { QuickAnswerRequest, QuickToolCall } from '../../src/types/quick-answer';
import { createToolContext } from '../helpers/tool-context';

const mocks = vi.hoisted(() => ({ decide: vi.fn() }));

vi.mock('../../src/services/decision.service', () => ({ decide: mocks.decide }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const REQUEST: QuickAnswerRequest = {
	message: 'hide the legend',
	messages: [],
	context: createToolContext(),
	settings: {},
};

const QUESTIONS = { legend: { type: 'choice' as const, instructions: 'Legend?', options: { show: null, hide: null } } };

describe('quickAnswer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.decide.mockResolvedValue({
			model: 'jev',
			usage: { inputTokens: 1, outputTokens: 1 },
			answers: { legend: { type: 'choice', value: 'hide', probabilities: { hide: 0.9 }, confidence: 0.9 } },
		});
	});

	it('runs the code steps before the first decision when preparing, and the rest when planning', async () => {
		const findChart = vi.fn(() => 'chart');
		const afterDecision = vi.fn((legend: string) => legend);
		const gate = quickAnswer('chart_edit', 'Chart edits')
			.then('chart', findChart)
			.decide('legend', {
				ask: () => ({ state: {}, questions: QUESTIONS }),
				read: (answers) => answers?.legend.value ?? null,
			})
			.then('after', afterDecision)
			.answer((legend) => toolCall(legend));

		const prepared = await gate.prepare(REQUEST);

		expect(findChart).toHaveBeenCalledOnce();
		expect(mocks.decide).not.toHaveBeenCalled();
		expect(afterDecision).not.toHaveBeenCalled();
		expect(await prepared?.plan()).toEqual(toolCall('hide'));
	});

	it.each([
		{ name: 'a failed check', flow: () => quickAnswer('gate', '').when('enabled', () => false) },
		{ name: 'a step finding nothing', flow: () => quickAnswer('gate', '').then('charts', () => null) },
	])('cannot answer after $name', async ({ flow }) => {
		const gate = flow().answer(() => toolCall('hide'));

		expect(await gate.prepare(REQUEST)).toBeNull();
	});

	it('skips the decision model when a decision step has nothing to ask', async () => {
		const read = vi.fn(() => 'only chart');
		const gate = quickAnswer('gate', '')
			.decide('pick_chart', { ask: () => null, read })
			.answer((chart) => toolCall(chart));

		expect(await (await gate.prepare(REQUEST))?.plan()).toEqual(toolCall('only chart'));
		expect(mocks.decide).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledWith(null, REQUEST, REQUEST);
	});

	it('asks the decision model a step names, for the caller of the chat', async () => {
		const model = { provider: 'typesafe' as const, modelId: 'jev-latest' };
		const gate = quickAnswer('gate', '')
			.decide('legend', { ask: () => ({ state: {}, questions: QUESTIONS }), read: () => 'hide', model })
			.answer((legend) => toolCall(legend));

		await (await gate.prepare(REQUEST))?.plan();

		expect(mocks.decide).toHaveBeenCalledWith(
			{ projectId: 'project-1', userId: 'user-1', chatId: 'chat-1' },
			{ state: {}, questions: QUESTIONS },
			model,
		);
	});

	it('leaves the message to the agent when a step after a decision stops', async () => {
		const gate = quickAnswer('gate', '')
			.decide('legend', { ask: () => ({ state: {}, questions: QUESTIONS }), read: () => 'hide' })
			.when('drawable', () => false)
			.answer((legend) => toolCall(legend));

		expect(await (await gate.prepare(REQUEST))?.plan()).toBeNull();
	});
});

function toolCall(text: string): QuickToolCall {
	return {
		toolName: 'display_chart',
		input: {
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			series: [{ data_key: 'revenue' }],
			title: 'Sales',
		},
		text,
	};
}
