import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answerWithoutAgent } from '../../src/services/quick-answer';
import type { UIMessage } from '../../src/types/chat';
import type { QuickAnswerGate, QuickToolCall } from '../../src/types/quick-answer';
import { createToolContext } from '../helpers/tool-context';
import { createUIMessageWriter } from '../helpers/ui-message-writer';

const mocks = vi.hoisted(() => ({
	getAgentSettings: vi.fn(),
	decide: vi.fn(),
	executeDisplayChart: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({ getAgentSettings: mocks.getAgentSettings }));
vi.mock('../../src/services/decision.service', () => ({ decide: mocks.decide }));
vi.mock('../../src/services/chart-quick-edit', () => ({ chartQuickEditGate: {} }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const CHART_CALL: QuickToolCall = {
	toolName: 'display_chart',
	input: {
		query_id: 'q1',
		chart_type: 'line',
		x_axis_key: 'month',
		series: [{ data_key: 'revenue' }],
		title: 'Sales',
	},
	text: 'Switched to lines on "Sales".',
};

describe('answerWithoutAgent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAgentSettings.mockResolvedValue({ decisionQuickEdits: true });
		mocks.executeDisplayChart.mockResolvedValue({ _version: '1', success: true });
	});

	it('answers with the tool call of the gate, streamed like a step of the agent', async () => {
		const writer = createUIMessageWriter();

		expect(await answer(writer, 'make it a line chart', [gate('chart_edit', CHART_CALL)])).toBe(true);

		expect(mocks.executeDisplayChart).toHaveBeenCalledWith(
			CHART_CALL.input,
			expect.objectContaining({ toolCallId: expect.stringMatching(/^quick_/) }),
		);
		expect(writer.types()).toEqual([
			'start-step',
			'tool-input-available',
			'tool-output-available',
			'text-start',
			'text-delta',
			'text-end',
			'finish-step',
			'finish',
		]);
		expect(writer.toolName()).toBe('display_chart');
		expect(writer.text()).toBe(CHART_CALL.text);
	});

	it.each([
		{
			name: 'a message with an attachment',
			text: 'make it a line chart',
			gates: () => [gate('chart_edit', CHART_CALL)],
			attachment: true,
		},
		{
			name: 'a long message',
			text: 'make it a line chart '.repeat(20),
			gates: () => [gate('chart_edit', CHART_CALL)],
		},
		{
			name: 'a gate with nothing to act on',
			text: 'make it a line chart',
			gates: () => [gate('chart_edit', CHART_CALL, { applies: false })],
		},
		{ name: 'a gate that declines', text: 'why did sales drop?', gates: () => [gate('chart_edit', null)] },
		{
			name: 'a gate that fails',
			text: 'make it a line chart',
			gates: () => [gate('chart_edit', new Error('No decision model.'))],
		},
	])('leaves $name to the agent', async ({ text, gates, attachment }) => {
		const writer = createUIMessageWriter();
		const messages = [userMessage(text, attachment)];

		expect(
			await answerWithoutAgent(
				writer.writer,
				{ messages, tools: tools(), context: createToolContext() },
				gates(),
			),
		).toBe(false);
		expect(mocks.executeDisplayChart).not.toHaveBeenCalled();
		expect(writer.chunks).toEqual([]);
	});

	it('does not run the tool once the run is stopped', async () => {
		const abort = new AbortController();
		const stopping = gate('chart_edit', CHART_CALL);
		stopping.plan.mockImplementation(async () => {
			abort.abort();
			return CHART_CALL;
		});
		const writer = createUIMessageWriter();
		const request = {
			messages: [userMessage('make it a line chart')],
			tools: tools(),
			context: createToolContext(),
		};

		expect(await answerWithoutAgent(writer.writer, { ...request, abortSignal: abort.signal }, [stopping])).toBe(
			false,
		);
		expect(mocks.executeDisplayChart).not.toHaveBeenCalled();
		expect(writer.chunks).toEqual([]);
	});

	it('writes nothing when the tool call fails', async () => {
		mocks.executeDisplayChart.mockResolvedValue({ _version: '1', success: false, error: 'Unknown query.' });
		const writer = createUIMessageWriter();

		expect(await answer(writer, 'make it a line chart', [gate('chart_edit', CHART_CALL)])).toBe(false);
		expect(writer.chunks).toEqual([]);
	});

	it('routes a message several gates could answer with one decision', async () => {
		const filterCall: QuickToolCall = { ...CHART_CALL, text: 'Filtered on Europe.' };
		const gates = [gate('chart_edit', CHART_CALL), gate('story_filter', filterCall)];
		routeTo('story_filter');
		const writer = createUIMessageWriter();

		expect(await answer(writer, 'only Europe', gates)).toBe(true);
		expect(writer.text()).toBe('Filtered on Europe.');
		expect(gates[0].plan).not.toHaveBeenCalled();
		expect(Object.keys(mocks.decide.mock.calls[0][1].questions.route.options)).toEqual([
			'chart_edit',
			'story_filter',
			'agent',
		]);
	});

	it.each([
		{ name: 'routed to the agent', route: 'agent', confidence: 0.95 },
		{ name: 'routed with low confidence', route: 'chart_edit', confidence: 0.5 },
	])('leaves a message $name to the agent', async ({ route, confidence }) => {
		const gates = [gate('chart_edit', CHART_CALL), gate('story_filter', CHART_CALL)];
		routeTo(route, confidence);

		expect(await answer(createUIMessageWriter(), 'why did sales drop?', gates)).toBe(false);
		expect(gates[0].plan).not.toHaveBeenCalled();
		expect(gates[1].plan).not.toHaveBeenCalled();
	});

	it('does not route when a single gate applies', async () => {
		const gates = [gate('chart_edit', CHART_CALL), gate('story_filter', CHART_CALL, { applies: false })];

		expect(await answer(createUIMessageWriter(), 'make it a line chart', gates)).toBe(true);
		expect(mocks.decide).not.toHaveBeenCalled();
	});
});

type TestGate = QuickAnswerGate & { plan: ReturnType<typeof vi.fn> };

function gate(name: string, result: QuickToolCall | Error | null, { applies = true } = {}): TestGate {
	const plan = vi.fn(async () => {
		if (result instanceof Error) {
			throw result;
		}
		return result;
	});
	return { name, description: `${name} requests`, prepare: vi.fn(async () => (applies ? { plan } : null)), plan };
}

function routeTo(route: string, confidence = 0.95): void {
	mocks.decide.mockResolvedValue({
		model: 'jev',
		usage: { inputTokens: 10, outputTokens: 1 },
		answers: { route: { type: 'choice', value: route, probabilities: { [route]: confidence }, confidence } },
	});
}

function answer(writer: ReturnType<typeof createUIMessageWriter>, text: string, gates: QuickAnswerGate[]) {
	return answerWithoutAgent(
		writer.writer,
		{ messages: [userMessage(text)], tools: tools(), context: createToolContext() },
		gates,
	);
}

function tools() {
	return { display_chart: { execute: mocks.executeDisplayChart } } as never;
}

function userMessage(text: string, withAttachment = false): UIMessage {
	const attachment = { type: 'file', mediaType: 'image/png', url: 'x' };
	return {
		id: 'm1',
		role: 'user',
		parts: [{ type: 'text', text }, ...(withAttachment ? [attachment] : [])],
	} as UIMessage;
}
