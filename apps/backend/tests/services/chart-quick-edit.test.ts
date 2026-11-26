import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answerWithoutAgent } from '../../src/services/quick-answer';
import type { UIMessage } from '../../src/types/chat';
import { createToolContext } from '../helpers/tool-context';
import { createUIMessageWriter } from '../helpers/ui-message-writer';

const mocks = vi.hoisted(() => ({
	getAgentSettings: vi.fn(),
	listLatestVersionsInChat: vi.fn(),
	getLatestVersionByStoryId: vi.fn(),
	getQueryResult: vi.fn(),
	decide: vi.fn(),
	executeStory: vi.fn(),
	executeDisplayChart: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({ getAgentSettings: mocks.getAgentSettings }));
vi.mock('../../src/queries/story.queries', () => ({
	listLatestVersionsInChat: mocks.listLatestVersionsInChat,
	getLatestVersionByStoryId: mocks.getLatestVersionByStoryId,
}));
vi.mock('../../src/services/query-result.service', () => ({ getQueryResult: mocks.getQueryResult }));
vi.mock('../../src/services/decision.service', () => ({ decide: mocks.decide }));
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const BAR_CHART = `<chart query_id="q1" chart_type="bar" x_axis_key="month" series='[{"data_key":"revenue"}]' title="Revenue" />`;
const PIE_CHART = `<chart query_id="q2" chart_type="pie" x_axis_key="region" series='[{"data_key":"orders"}]' title="Orders" />`;
const TWO_SERIES_CHART = `<chart query_id="q3" chart_type="line" x_axis_key="month" series='[{"data_key":"a"},{"data_key":"b"}]' title="Costs" />`;

const CHAT_CHART = {
	query_id: 'q4',
	chart_type: 'bar',
	x_axis_key: 'month',
	x_axis_type: 'date',
	series: [
		{ data_key: 'revenue', label: 'Revenue' },
		{ data_key: 'rate', label: 'Rate' },
	],
	title: 'Sales',
};
const CHAT_CHART_ROWS = {
	columns: ['month', 'region', 'revenue', 'rate', 'orders'],
	data: [{ month: '2026-01-01', region: 'EU', revenue: 10, rate: 0.4, orders: 3 }],
};

const CONTEXT = createToolContext();

describe('chartQuickEditGate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAgentSettings.mockResolvedValue({ decisionQuickEdits: true });
		mocks.getQueryResult.mockResolvedValue(null);
		givenStory(`# Sales\n\n${BAR_CHART}\n`);
		mocks.executeStory.mockResolvedValue({ success: true, id: 'sales', version: 2, code: '', title: 'Sales' });
		mocks.executeDisplayChart.mockResolvedValue({ _version: '1', success: true });
	});

	it('edits a story chart through the story tool and answers without the agent', async () => {
		answerWith({ chart_type: choice('line'), legend: choice('hide') });
		const writer = createUIMessageWriter();

		const answered = await run(writer, 'make it a line chart without legend');

		expect(answered).toBe(true);
		const [input] = mocks.executeStory.mock.calls[0];
		expect(input).toMatchObject({ action: 'update', id: 'story-1', search: BAR_CHART });
		expect(input.replace).toContain('chart_type="line"');
		expect(input.replace).toContain('show_legend="false"');
		expect(writer.text()).toBe('Switched to lines, hid the legend on "Revenue".');
	});

	it('leaves the message to the agent when it asks for more than a display change', async () => {
		answerWith({ chart_type: choice('line') }, 0.4);

		expect(await run(createUIMessageWriter(), 'make it a line chart and add last year')).toBe(false);
		expect(mocks.executeStory).not.toHaveBeenCalled();
	});

	it('leaves the message to the agent when the chart it means is unclear', async () => {
		givenStory(`${BAR_CHART}\n${TWO_SERIES_CHART}`);
		answerWith({ chart: choice('chart_1', 0.5), chart_type: choice('area') });

		expect(await run(createUIMessageWriter(), 'make it an area chart')).toBe(false);
		expect(mocks.decide).toHaveBeenCalledTimes(1);
	});

	it('edits the chart the decision model picks among several', async () => {
		givenStory(`${BAR_CHART}\n${TWO_SERIES_CHART}`);
		answerWith({ chart: choice('chart_1'), chart_type: choice('stacked_area') });

		expect(await run(createUIMessageWriter(), 'stack the costs')).toBe(true);
		expect(mocks.executeStory.mock.calls[0][0]).toMatchObject({ search: TWO_SERIES_CHART });
	});

	it.each([
		['a change the chart cannot be drawn with', TWO_SERIES_CHART, 'pie'],
		['a change that changes nothing', PIE_CHART, 'pie'],
	])('leaves %s to the agent', async (_, chart, chartType) => {
		givenStory(chart);
		answerWith({ chart_type: choice(chartType) });

		expect(await run(createUIMessageWriter(), 'make it a pie')).toBe(false);
	});

	it('does not ask the decision model when quick edits are off', async () => {
		mocks.getAgentSettings.mockResolvedValue({});

		expect(await run(createUIMessageWriter(), 'make it a line chart')).toBe(false);
		expect(mocks.decide).not.toHaveBeenCalled();
	});

	describe('on the chart shown last in the chat', () => {
		beforeEach(() => {
			givenStory(null);
			mocks.getQueryResult.mockResolvedValue(CHAT_CHART_ROWS);
		});

		it('displays the edited chart again through the display_chart tool', async () => {
			answerWith({ chart_type: choice('stacked_bar_100') });
			const writer = createUIMessageWriter();

			expect(await runInChat(writer, 'stacked 100%')).toBe(true);
			expect(mocks.executeStory).not.toHaveBeenCalled();
			expect(mocks.executeDisplayChart.mock.calls[0][0]).toEqual({
				...CHAT_CHART,
				chart_type: 'stacked_bar_100',
			});
			expect(writer.toolName()).toBe('display_chart');
			expect(writer.text()).toBe('Switched to vertical bars stacked to 100% on "Sales".');
		});

		it.each([
			{
				name: 'removes a series',
				answers: { remove_series: choice('series_0') },
				expected: { series: [{ data_key: 'rate', label: 'Rate' }] },
			},
			{
				name: 'draws a series as a line on the right axis',
				answers: { series_1: choice('line'), series_1_axis: choice('right') },
				expected: {
					chart_type: 'mixed',
					series: [
						{ data_key: 'revenue', label: 'Revenue', series_type: 'bar' },
						{ data_key: 'rate', label: 'Rate', series_type: 'line', y_axis: 'right' },
					],
				},
			},
			{
				name: 'formats the values in dollars without decimals',
				answers: { value_format: choice('dollars'), decimals: choice('no_decimals') },
				expected: {
					series: [
						{ data_key: 'revenue', label: 'Revenue', value_format: { d3_format: ',.0f', prefix: '$' } },
						{ data_key: 'rate', label: 'Rate', value_format: { d3_format: ',.0f', prefix: '$' } },
					],
				},
			},
			{
				name: 'puts another column on the X-axis',
				answers: { x_axis: choice('column_region') },
				expected: { x_axis_key: 'region', x_axis_type: 'category' },
			},
			{
				name: 'brings back a column as a series',
				answers: { add_series: choice('column_orders') },
				expected: { series: [...CHAT_CHART.series, { data_key: 'orders' }] },
			},
			{
				name: 'adds a column as a line on the right axis',
				answers: {
					add_series: choice('column_orders'),
					add_series_style: choice('line'),
					add_series_axis: choice('right'),
				},
				expected: {
					chart_type: 'mixed',
					series: [
						{ data_key: 'revenue', series_type: 'bar' },
						{ data_key: 'rate', series_type: 'bar' },
						{ data_key: 'orders', series_type: 'line', y_axis: 'right' },
					],
				},
			},
		])('$name', async ({ answers, expected }) => {
			answerWith(answers);

			expect(await runInChat(createUIMessageWriter(), 'edit the chart')).toBe(true);
			expect(mocks.executeDisplayChart.mock.calls[0][0]).toMatchObject(expected);
		});

		it('edits the chart shown last when the message does not say which chart it means', async () => {
			givenStory(BAR_CHART);
			answerWith({ chart: choice('chart_1', 0.4), data_labels: choice('show') });

			expect(await runInChat(createUIMessageWriter(), 'show the values')).toBe(true);
			expect(mocks.executeStory).not.toHaveBeenCalled();
			expect(mocks.executeDisplayChart.mock.calls[0][0]).toMatchObject({ show_data_labels: true });
		});

		it('asks about the series and the unused columns of the chart', async () => {
			answerWith({});

			await runInChat(createUIMessageWriter(), 'edit the chart');

			const { questions } = mocks.decide.mock.calls[0][1];
			expect(Object.keys(questions)).toEqual(
				expect.arrayContaining([
					'remove_series',
					'series_0',
					'series_1_axis',
					'x_axis',
					'add_series',
					'value_format',
				]),
			);
			expect(Object.keys(questions.x_axis.options)).toEqual(['column_region', 'column_orders', 'keep']);
		});
	});
});

function givenStory(code: string | null): void {
	mocks.listLatestVersionsInChat.mockResolvedValue(
		code ? [{ storyId: 'story-1', slug: 'sales', title: 'Sales', format: 'classic', archivedAt: null, code }] : [],
	);
}

function answerWith(changes: Partial<Record<string, ReturnType<typeof choice>>>, editProbability = 0.97): void {
	mocks.decide.mockImplementation(async (_caller, { questions }: { questions: Record<string, unknown> }) => ({
		model: 'jev',
		usage: { inputTokens: 10, outputTokens: 1 },
		answers: {
			...Object.fromEntries(Object.keys(questions).map((name) => [name, choice('keep')])),
			is_display_edit: { type: 'boolean', value: editProbability >= 0.5, probability: editProbability },
			...changes,
		},
	}));
}

function choice(value: string, confidence = 0.95) {
	return { type: 'choice' as const, value, probabilities: { [value]: confidence }, confidence };
}

function run(writer: ReturnType<typeof createUIMessageWriter>, text: string): Promise<boolean> {
	return answerWithoutAgent(writer.writer, withTools([userMessage(text)]));
}

function runInChat(writer: ReturnType<typeof createUIMessageWriter>, text: string): Promise<boolean> {
	const chartMessage = {
		id: 'm0',
		role: 'assistant',
		parts: [
			{
				type: 'tool-display_chart',
				toolCallId: 'c1',
				state: 'output-available',
				input: CHAT_CHART,
				output: { _version: '1', success: true },
			},
		],
	} as UIMessage;
	return answerWithoutAgent(writer.writer, withTools([chartMessage, userMessage(text)]));
}

function withTools(messages: UIMessage[]) {
	const tools = { story: { execute: mocks.executeStory }, display_chart: { execute: mocks.executeDisplayChart } };
	return { messages, tools: tools as never, context: CONTEXT };
}

function userMessage(text: string, ...parts: unknown[]): UIMessage {
	return { id: 'm1', role: 'user', parts: [{ type: 'text', text }, ...parts] } as UIMessage;
}
