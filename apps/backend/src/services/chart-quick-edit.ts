import { buildStoryChartBlock } from '@nao/shared';
import { isBuiltinChartType } from '@nao/shared/chart-types';
import { extractParameterIds } from '@nao/shared/story-parameter-template';
import { chartBlockToInput, chartTagRegex, parseChartBlock } from '@nao/shared/story-segments';
import { displayChart } from '@nao/shared/tools';

import * as storyQueries from '../queries/story.queries';
import type { UIMessage } from '../types/chat';
import type { DecisionAnswer, DecisionAnswers, DecisionQuestions } from '../types/decision';
import type { QuickAnswerRequest, QuickToolCall } from '../types/quick-answer';
import type { LinkedStory, ToolContext } from '../types/tools';
import {
	applyChartEdit,
	buildChartEditQuestions,
	type ChartColumns,
	type ChartConfig,
	describeChartState,
	DISPLAY_EDIT_QUESTION,
	isDrawable,
	readColumns,
} from './chart-edit-decision';
import { getQueryResult } from './query-result.service';
import { quickAnswer } from './quick-answer-flow';

const MAX_CHARTS = 30;
const MIN_EDIT_PROBABILITY = 0.6;
const MIN_CHART_CONFIDENCE = 0.7;

type EditableChart =
	| { kind: 'chat'; input: displayChart.Input; config: ChartConfig }
	| { kind: 'story'; storyId: string; storySlug: string; storyTitle: string; rawTag: string; config: ChartConfig };

type ChartWithColumns = { chart: EditableChart; columns: ChartColumns };
type ChartEdit = ChartWithColumns & { config: ChartConfig; changes: string[] };

/**
 * Restyles one chart, shown in the chat or in a story (its type, series, format, axes...), through the
 * display_chart or story tool, so the edit is shown and versioned like an edit of the agent.
 */
export const chartQuickEditGate = quickAnswer(
	'chart_edit',
	'Change how an existing chart is displayed: its type, series, legend, values, number format or axes',
)
	.when('enabled', (_, { settings }) => settings.decisionQuickEdits === true)
	.then('charts', ({ messages, context }) => listEditableCharts(messages, context))
	.decide('pick_chart', { ask: askWhichChart, read: readWhichChart })
	.then('columns', loadColumns)
	.decide('chart_edit', { ask: askChartEdit, read: readChartEdit })
	.when('drawable', (edit) => isDrawable(edit.config))
	.answer(toToolCall);

/** Only asked when the chat holds several charts. */
function askWhichChart(charts: EditableChart[], { message }: QuickAnswerRequest) {
	if (charts.length === 1) {
		return null;
	}
	return {
		state: { message, charts: charts.map((chart, index) => ({ id: chartId(index), ...describeChart(chart) })) },
		questions: {
			chart: {
				type: 'choice' as const,
				instructions: 'Which chart does the message ask to change?',
				options: Object.fromEntries(charts.map((chart, index) => [chartId(index), describeChart(chart).label])),
			},
		},
	};
}

/** A message that does not say which chart it means is about the chart the conversation touched last. */
function readWhichChart(
	answers: DecisionAnswers<{
		chart: { type: 'choice'; instructions: string; options: Record<string, string> };
	}> | null,
	charts: EditableChart[],
	{ messages }: QuickAnswerRequest,
): EditableChart | null {
	if (!answers) {
		return charts[0];
	}
	if (answers.chart.confidence < MIN_CHART_CONFIDENCE) {
		return findLastTouchedChart(messages, charts) ?? null;
	}
	return charts[Number(answers.chart.value.replace('chart_', ''))] ?? null;
}

async function loadColumns(chart: EditableChart, { context }: QuickAnswerRequest): Promise<ChartWithColumns> {
	return { chart, columns: readColumns(await getQueryResult(context, chart.config.query_id)) };
}

function askChartEdit({ chart, columns }: ChartWithColumns, { message }: QuickAnswerRequest) {
	return {
		state: { message, chart: describeChartState(chart.config, columns) },
		questions: { is_display_edit: DISPLAY_EDIT_QUESTION, ...buildChartEditQuestions(chart.config, columns) },
	};
}

function readChartEdit(answers: DecisionAnswers<DecisionQuestions> | null, target: ChartWithColumns): ChartEdit | null {
	if (!answers || !isDisplayEdit(answers.is_display_edit)) {
		return null;
	}
	const { config, changes } = applyChartEdit(target.chart.config, answers, target.columns);
	return changes.length > 0 ? { ...target, config, changes } : null;
}

function toToolCall({ chart, config, changes }: ChartEdit): QuickToolCall {
	const text = describeEdit(chart, changes);
	if (chart.kind === 'chat') {
		return { toolName: 'display_chart', input: { ...chart.input, ...config } as displayChart.Input, text };
	}
	const replace = buildStoryChartBlock(config);
	return { toolName: 'story', input: { action: 'update', id: chart.storyId, search: chart.rawTag, replace }, text };
}

function describeEdit(chart: EditableChart, changes: string[]): string {
	const sentence = changes.join(', ');
	const title = chart.config.title || (chart.kind === 'story' ? chart.storyTitle : 'the chart');
	return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} on "${title}".`;
}

function isDisplayEdit(answer: DecisionAnswer | undefined): boolean {
	return answer?.type === 'boolean' && answer.value && answer.probability >= MIN_EDIT_PROBABILITY;
}

function describeChart(chart: EditableChart) {
	const where = chart.kind === 'chat' ? 'shown last in the conversation' : `of the story "${chart.storyTitle}"`;
	const title = chart.config.title || 'Untitled';
	return {
		label: `"${title}", a ${chart.config.chart_type} chart ${where}`,
		title,
		type: chart.config.chart_type,
		series: chart.config.series.map((series) => series.label ?? series.data_key),
	};
}

function chartId(index: number): string {
	return `chart_${index}`;
}

async function listEditableCharts(messages: UIMessage[], context: ToolContext): Promise<EditableChart[] | null> {
	const stories = await listEditableStories(context.chatId, context.linkedStory);
	const charts = [...findLastChatChart(messages), ...stories.flatMap(findStoryCharts)].slice(0, MAX_CHARTS);
	return charts.length > 0 ? charts : null;
}

/** The chart the agent displayed last in the chat; earlier ones are left to the agent. */
function findLastChatChart(messages: UIMessage[]): EditableChart[] {
	for (const part of messages.flatMap((message) => message.parts).reverse()) {
		if (part.type !== 'tool-display_chart' || part.state !== 'output-available' || !part.output.success) {
			continue;
		}
		const { input } = part;
		if (!displayChart.isChartInput(input) || !isBuiltinChartType(input.chart_type)) {
			return [];
		}
		return [{ kind: 'chat', input, config: input as ChartConfig }];
	}
	return [];
}

/** The chart the agent displayed or put in a story last, when that story holds only this chart. */
function findLastTouchedChart(messages: UIMessage[], charts: EditableChart[]): EditableChart | undefined {
	for (const part of messages.flatMap((message) => message.parts).reverse()) {
		if (part.type === 'tool-display_chart' && part.state === 'output-available' && part.output.success) {
			return charts.find((chart) => chart.kind === 'chat');
		}
		if (part.type === 'tool-story' && part.state === 'output-available' && part.output.success) {
			const { id: slug, story_id: storyId } = part.output;
			const storyCharts = charts.filter(
				(chart) => chart.kind === 'story' && (chart.storyId === storyId || chart.storySlug === slug),
			);
			return storyCharts.length === 1 ? storyCharts[0] : undefined;
		}
	}
	return undefined;
}

type EditableStory = { storyId: string; slug: string; title: string; code: string };

async function listEditableStories(chatId: string, linkedStory?: LinkedStory): Promise<EditableStory[]> {
	const chatStories = (await storyQueries.listLatestVersionsInChat(chatId))
		.filter((story) => story.archivedAt === null && story.format === 'classic' && story.code)
		.map((story) => ({ storyId: story.storyId, slug: story.slug, title: story.title, code: story.code ?? '' }));
	if (!linkedStory?.canEdit || linkedStory.format !== 'classic') {
		return chatStories;
	}
	if (chatStories.some((story) => story.storyId === linkedStory.storyId)) {
		return chatStories;
	}
	const latest = await storyQueries.getLatestVersionByStoryId(linkedStory.storyId);
	return latest?.code
		? [
				...chatStories,
				{ storyId: linkedStory.storyId, slug: linkedStory.slug, title: linkedStory.title, code: latest.code },
			]
		: chatStories;
}

/** The charts of a classic story; a chart with story parameters is left to the agent. */
function findStoryCharts(story: EditableStory): EditableChart[] {
	return [...story.code.matchAll(chartTagRegex('g'))].flatMap(([rawTag, attributes]) => {
		const parsed = extractParameterIds(rawTag).length === 0 ? parseChartBlock(attributes) : null;
		if (!parsed || !isBuiltinChartType(parsed.chartType)) {
			return [];
		}
		return [
			{
				kind: 'story' as const,
				storyId: story.storyId,
				storySlug: story.slug,
				storyTitle: story.title,
				rawTag,
				config: chartBlockToInput(parsed),
			},
		];
	});
}
