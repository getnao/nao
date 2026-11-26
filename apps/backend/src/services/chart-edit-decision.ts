import type { StoryChartBlockInput } from '@nao/shared';
import { chartTypeSupportsBreakdown } from '@nao/shared/chart-series';
import { builtinChartConfigError, type ChartType, isBuiltinChartType } from '@nao/shared/chart-types';
import type { displayChart } from '@nao/shared/tools';

import type { DecisionAnswer, DecisionQuestion, DecisionQuestions } from '../types/decision';

export type ChartConfig = StoryChartBlockInput;
export type ChartColumns = { name: string; kind: 'number' | 'date' | 'text' }[];
export type ChartEditAnswers = Record<string, DecisionAnswer>;

const MIN_CHANGE_CONFIDENCE = 0.75;
/** Reading the X-axis differently is rarely asked, and a wrong guess breaks the chart. */
const MIN_X_AXIS_TYPE_CONFIDENCE = 0.9;
const MAX_SERIES_QUESTIONS = 8;
const KEEP = 'keep';

type Series = ChartConfig['series'][number];
type ValueFormat = displayChart.SeriesConfig['value_format'];
type FormatKind = keyof typeof FORMAT_CHOICES;

export const DISPLAY_EDIT_QUESTION = {
	type: 'boolean',
	instructions:
		'Does the message only ask to change how one existing chart is displayed: its chart type, its legend, the values drawn on it, the total of its tooltip, the comparison of a KPI, whether its Y-axis starts at zero, which series it shows and how each is drawn (bars, line, area, left or right axis), how its numbers are formatted (currency, percent, compact, decimals), or which column is on its X-axis?',
	criteria: {
		true: 'Every change asked is one of these display settings.',
		false: 'The message asks a question, or for new data, a filter, a new chart, a title, a label, a color, a text, or anything else.',
	},
} satisfies DecisionQuestion;

const CHART_TYPE_CHOICES: Record<ChartType, string> = {
	bar: 'Vertical bars',
	stacked_bar: 'Vertical bars stacked on each other',
	stacked_bar_100: 'Vertical bars stacked to 100%',
	horizontal_bar: 'Horizontal bars',
	horizontal_bar_100: 'Horizontal bars stacked to 100%',
	line: 'Lines',
	area: 'Areas',
	stacked_area: 'Areas stacked on each other',
	stacked_area_100: 'Areas stacked to 100%',
	mixed: 'Bars and lines combined',
	pie: 'A pie',
	donut: 'A donut',
	kpi_card: 'A single KPI number',
	scatter: 'Scattered points',
	radar: 'A radar',
};

const TOGGLE_CHOICES = {
	legend: { show: 'Show the legend', hide: 'Hide the legend' },
	data_labels: {
		show: 'Write each value as a label on the chart itself',
		hide: 'Remove the value labels written on the chart',
	},
	total: { show: 'Show the total in the tooltip', hide: 'Hide the total in the tooltip' },
	y_axis: { zero: 'Start the Y-axis at zero', auto: 'Let the Y-axis scale on its own' },
	comparison: {
		percentage: 'Compare the KPI to the previous period in percent',
		variation: 'Compare the KPI to the previous period as a variation',
		absolute: 'Compare the KPI to the previous period as an absolute difference',
		none: 'Hide the comparison of the KPI',
	},
} as const;

const FORMAT_CHOICES = {
	plain: 'Plain numbers, like 1,234',
	compact: 'Compact numbers, like 1.2K',
	dollars: 'US dollars, like $1,234',
	euros: 'Euros, like 1,234 €',
	percent: 'Percentages, like 12.5%',
};

const DECIMAL_CHOICES = { no_decimals: 'No decimals', one_decimal: 'One decimal', two_decimals: 'Two decimals' };
const DECIMAL_PLACES: Record<string, number> = { no_decimals: 0, one_decimal: 1, two_decimals: 2 };
const DEFAULT_DECIMALS: Record<FormatKind, number> = { plain: 0, compact: 0, dollars: 0, euros: 0, percent: 1 };

const SERIES_CHOICES = {
	bar: 'Draw it as bars, while other series may be drawn differently',
	line: 'Draw it as a line, while other series may be drawn differently',
	area: 'Draw it as an area, while other series may be drawn differently',
};

const AXIS_CHOICES = { left: 'The left Y-axis', right: 'The right Y-axis' };

/** What the decision model can change on this chart, each with a "keep" option for what the message does not ask. */
export function buildChartEditQuestions(chart: ChartConfig, columns: ChartColumns): DecisionQuestions {
	const unusedColumns = columns.filter((column) => !isPlotted(chart, column.name));
	return {
		chart_type: changeQuestion('Which chart type does the message ask for?', CHART_TYPE_CHOICES),
		legend: changeQuestion('What does the message ask for the legend?', TOGGLE_CHOICES.legend),
		data_labels: changeQuestion(
			'Does the message ask for value labels written on the chart itself? Formatting the numbers, as a currency or a percent, is not about these labels.',
			TOGGLE_CHOICES.data_labels,
		),
		total: changeQuestion('What does the message ask for the total of the tooltip?', TOGGLE_CHOICES.total),
		y_axis: changeQuestion('What does the message ask for the start of the Y-axis?', TOGGLE_CHOICES.y_axis),
		value_format: changeQuestion('How does the message ask to format the numbers?', FORMAT_CHOICES),
		decimals: changeQuestion('How many decimals does the message ask for?', DECIMAL_CHOICES),
		...(chart.chart_type === 'kpi_card' && {
			comparison: changeQuestion(
				'What does the message ask for the comparison to the previous period?',
				TOGGLE_CHOICES.comparison,
			),
		}),
		...(unusedColumns.length > 0 && {
			x_axis: changeQuestion(
				'Which column does the message ask to put on the X-axis?',
				columnChoices(unusedColumns),
			),
		}),
		x_axis_type: changeQuestion('What does the message ask the X-axis values to be read as?', {
			date: 'Dates on a time scale',
			category: 'Separate categories',
		}),
		...(unusedColumns.some((column) => column.kind === 'number') && {
			add_series: changeQuestion(
				'Which column does the message ask to add, or bring back, as a series?',
				columnChoices(unusedColumns.filter((column) => column.kind === 'number')),
			),
			add_series_style: changeQuestion('How does the message ask to draw the series it adds?', SERIES_CHOICES),
			add_series_axis: changeQuestion(
				'Which Y-axis does the message ask the series it adds to use?',
				AXIS_CHOICES,
			),
		}),
		...(chart.series.length > 1 && {
			remove_series: changeQuestion(
				'Which series does the message ask to remove from the chart?',
				Object.fromEntries(
					chart.series.map((series, index) => [`series_${index}`, `The series "${seriesName(series)}"`]),
				),
			),
		}),
		...seriesQuestions(chart.series),
	};
}

/** The chart as the decision model reads it, next to the message. */
export function describeChartState(chart: ChartConfig, columns: ChartColumns) {
	return {
		title: chart.title,
		type: chart.chart_type,
		x_axis: chart.x_axis_key,
		x_axis_type: chart.x_axis_type ?? 'automatic',
		series: chart.series.map((series) => ({
			name: seriesName(series),
			drawn_as: chart.chart_type === 'mixed' ? (series.series_type ?? 'bar') : undefined,
			axis: chart.chart_type === 'mixed' ? (series.y_axis ?? 'left') : undefined,
			format: series.value_format,
		})),
		legend: chart.show_legend ?? 'automatic',
		values_shown: chart.show_data_labels ?? false,
		y_axis_min: chart.y_axis_min ?? 'automatic',
		other_columns: columns.filter((column) => !isPlotted(chart, column.name)).map((column) => column.name),
	};
}

/** Each change the model is sure the message asks for, applied when it changes the chart. */
export function applyChartEdit(current: ChartConfig, answers: ChartEditAnswers, columns: ChartColumns) {
	const edit = new ChartEdit(current);
	const chartType = asked(answers, 'chart_type');
	if (chartType && isBuiltinChartType(chartType)) {
		edit.set('chart_type', chartType, `switched to ${CHART_TYPE_CHOICES[chartType].toLowerCase()}`);
	}
	const canMix = !chartType || chartType === 'mixed';
	if (canMix) {
		restyleSeries(edit, current, answers);
	}
	applyToggles(edit, answers);
	applyXAxis(edit, answers, columns);
	addSeries(edit, current, answers, columns, canMix);
	formatValues(edit, answers);
	removeSeries(edit, current, answers);
	return { config: edit.config, changes: edit.changes };
}

export function isDrawable(config: ChartConfig): boolean {
	if (!isBuiltinChartType(config.chart_type)) {
		return false;
	}
	if (config.breakdown_key && !chartTypeSupportsBreakdown(config.chart_type)) {
		return false;
	}
	const shape = {
		xAxisKey: config.x_axis_key,
		seriesCount: config.series.length,
		hasBreakdown: !!config.breakdown_key,
	};
	return builtinChartConfigError(config.chart_type, shape) === null;
}

export function readColumns(result: { columns: string[]; data: Record<string, unknown>[] } | null): ChartColumns {
	return (result?.columns ?? []).map((name) => ({ name, kind: columnKind(result?.data ?? [], name) }));
}

class ChartEdit {
	readonly config: ChartConfig;
	readonly changes: string[] = [];

	constructor(current: ChartConfig) {
		this.config = { ...current, series: current.series.map((series) => ({ ...series })) };
	}

	set<K extends keyof ChartConfig>(key: K, value: ChartConfig[K], change: string): void {
		if (this.config[key] !== value) {
			this.config[key] = value;
			this.changes.push(change);
		}
	}

	setSeries(series: Series[], change: string): void {
		if (JSON.stringify(series) !== JSON.stringify(this.config.series)) {
			this.config.series = series;
			this.changes.push(change);
		}
	}
}

function applyToggles(edit: ChartEdit, answers: ChartEditAnswers): void {
	const legend = asked(answers, 'legend');
	if (legend) {
		edit.set('show_legend', legend === 'show', `${legend === 'show' ? 'showed' : 'hid'} the legend`);
	}
	const dataLabels = asked(answers, 'data_labels');
	if (dataLabels) {
		edit.set('show_data_labels', dataLabels === 'show', `${dataLabels === 'show' ? 'showed' : 'hid'} the values`);
	}
	const total = asked(answers, 'total');
	if (total) {
		edit.set('hide_total', total === 'hide', `${total === 'show' ? 'showed' : 'hid'} the tooltip total`);
	}
	const yAxis = asked(answers, 'y_axis');
	if (yAxis) {
		edit.set(
			'y_axis_min',
			yAxis === 'zero' ? 0 : undefined,
			`let the Y-axis ${yAxis === 'zero' ? 'start at zero' : 'scale on its own'}`,
		);
	}
	const comparison = asked(answers, 'comparison');
	if (comparison && edit.config.chart_type === 'kpi_card') {
		edit.set(
			'comparison_mode',
			comparison as ChartConfig['comparison_mode'],
			`set the comparison to ${comparison}`,
		);
	}
}

/** A series drawn differently from the others, or moved to the right axis, turns the chart into a mixed chart. */
function restyleSeries(edit: ChartEdit, current: ChartConfig, answers: ChartEditAnswers): void {
	const fallbackType = defaultSeriesType(current.chart_type);
	const changes: string[] = [];
	const series = edit.config.series.map((item, index) => {
		const seriesType = asked(answers, `series_${index}`) as Series['series_type'] | null;
		const axis = asked(answers, `series_${index}_axis`);
		if (seriesType && seriesType !== (item.series_type ?? fallbackType)) {
			changes.push(`drew ${seriesName(item)} as ${seriesType === 'bar' ? 'bars' : `a ${seriesType}`}`);
		}
		if (axis && axis !== (item.y_axis ?? 'left')) {
			changes.push(`moved ${seriesName(item)} to the ${axis} axis`);
		}
		return {
			...item,
			series_type: seriesType ?? item.series_type ?? fallbackType,
			y_axis: (axis as Series['y_axis']) ?? item.y_axis,
		};
	});
	if (changes.length > 0) {
		makeMixed(edit, current);
		edit.setSeries(series, changes.join(', '));
	}
}

function makeMixed(edit: ChartEdit, current: ChartConfig): void {
	const fallbackType = defaultSeriesType(current.chart_type);
	edit.set('chart_type', 'mixed', 'combined bars and lines');
	edit.config.series = edit.config.series.map((series) => ({
		...series,
		series_type: series.series_type ?? fallbackType,
	}));
}

function applyXAxis(edit: ChartEdit, answers: ChartEditAnswers, columns: ChartColumns): void {
	const column = askedColumn(answers, 'x_axis', columns);
	if (column) {
		edit.set('x_axis_key', column.name, `put ${column.name} on the X-axis`);
		edit.config.x_axis_label = undefined;
		edit.config.x_axis_type = column.kind === 'date' ? 'date' : column.kind === 'number' ? 'number' : 'category';
	}
	const xAxisType = asked(answers, 'x_axis_type', MIN_X_AXIS_TYPE_CONFIDENCE);
	if (xAxisType) {
		edit.set(
			'x_axis_type',
			xAxisType as ChartConfig['x_axis_type'],
			`read the X-axis as ${xAxisType === 'date' ? 'dates' : 'categories'}`,
		);
	}
}

function addSeries(
	edit: ChartEdit,
	current: ChartConfig,
	answers: ChartEditAnswers,
	columns: ChartColumns,
	canMix: boolean,
): void {
	const column = askedColumn(answers, 'add_series', columns);
	if (!column || edit.config.series.some((series) => series.data_key === column.name)) {
		return;
	}
	const seriesType = canMix ? (asked(answers, 'add_series_style') as Series['series_type'] | null) : null;
	const axis = canMix ? (asked(answers, 'add_series_axis') as Series['y_axis'] | null) : null;
	if (seriesType || axis) {
		makeMixed(edit, current);
	}
	const added: Series = {
		data_key: column.name,
		value_format: edit.config.series[0]?.value_format,
		...(seriesType && { series_type: seriesType }),
		...(axis && { y_axis: axis }),
	};
	const style = [
		seriesType && ` as ${seriesType === 'bar' ? 'bars' : `a ${seriesType}`}`,
		axis && ` on the ${axis} axis`,
	];
	edit.setSeries([...edit.config.series, added], `added ${column.name}${style.filter(Boolean).join('')}`);
}

function formatValues(edit: ChartEdit, answers: ChartEditAnswers): void {
	const kind = asked(answers, 'value_format') as FormatKind | null;
	const decimals = asked(answers, 'decimals');
	if (!kind && !decimals) {
		return;
	}
	const places = decimals ? DECIMAL_PLACES[decimals] : undefined;
	const series = edit.config.series.map((item) => ({
		...item,
		value_format: buildValueFormat(
			kind ?? formatKindOf(item.value_format),
			places ?? decimalsOf(item.value_format),
		),
	}));
	const change = [
		kind && `formatted the values as ${kind}`,
		decimals && `showed ${DECIMAL_CHOICES[decimals as keyof typeof DECIMAL_CHOICES].toLowerCase()}`,
	];
	edit.setSeries(series, change.filter(Boolean).join(', '));
}

function removeSeries(edit: ChartEdit, current: ChartConfig, answers: ChartEditAnswers): void {
	const removed = current.series.find((_, index) => asked(answers, 'remove_series') === `series_${index}`);
	if (removed) {
		const kept = edit.config.series.filter((series) => series.data_key !== removed.data_key);
		edit.setSeries(kept, `removed ${seriesName(removed)}`);
	}
}

function buildValueFormat(kind: FormatKind, decimals: number | undefined): ValueFormat {
	const places = decimals ?? DEFAULT_DECIMALS[kind];
	switch (kind) {
		case 'compact':
			return { d3_format: '.3~s' };
		case 'dollars':
			return { d3_format: `,.${places}f`, prefix: '$' };
		case 'euros':
			return { d3_format: `,.${places}f`, suffix: ' €' };
		case 'percent':
			return { d3_format: `,.${places}f`, suffix: '%' };
		default:
			return { d3_format: `,.${places}f` };
	}
}

function formatKindOf(format: ValueFormat): FormatKind {
	if (format?.prefix?.includes('$')) {
		return 'dollars';
	}
	if (format?.suffix?.includes('€') || format?.prefix?.includes('€')) {
		return 'euros';
	}
	if (format?.suffix?.includes('%')) {
		return 'percent';
	}
	return format?.d3_format?.endsWith('s') ? 'compact' : 'plain';
}

function decimalsOf(format: ValueFormat): number | undefined {
	const match = format?.d3_format?.match(/\.(\d+)f$/);
	return match ? Number(match[1]) : undefined;
}

function seriesQuestions(series: Series[]): DecisionQuestions {
	if (series.length > MAX_SERIES_QUESTIONS) {
		return {};
	}
	return Object.fromEntries(
		series.flatMap((item, index) => [
			[
				`series_${index}`,
				changeQuestion(`How does the message ask to show the series "${seriesName(item)}"?`, SERIES_CHOICES),
			],
			[
				`series_${index}_axis`,
				changeQuestion(
					`Which Y-axis does the message ask the series "${seriesName(item)}" to use?`,
					AXIS_CHOICES,
				),
			],
		]),
	);
}

function changeQuestion(instructions: string, options: Record<string, string>): DecisionQuestion {
	return {
		type: 'choice',
		instructions: `${instructions} Answer "keep" when the message does not ask for it.`,
		options: { ...options, [KEEP]: 'The message does not ask to change this' },
	};
}

function columnChoices(columns: ChartColumns): Record<string, string> {
	return Object.fromEntries(columns.map((column) => [columnChoice(column.name), `The column "${column.name}"`]));
}

function askedColumn(answers: ChartEditAnswers, question: string, columns: ChartColumns) {
	const choice = asked(answers, question);
	return choice ? columns.find((column) => columnChoice(column.name) === choice) : undefined;
}

function columnChoice(name: string): string {
	return `column_${name}`;
}

function asked(answers: ChartEditAnswers, question: string, minConfidence = MIN_CHANGE_CONFIDENCE): string | null {
	const answer = answers[question];
	if (answer?.type !== 'choice' || answer.value === KEEP || answer.confidence < minConfidence) {
		return null;
	}
	return answer.value;
}

function isPlotted(chart: ChartConfig, column: string): boolean {
	return chart.x_axis_key === column || chart.series.some((series) => series.data_key === column);
}

function seriesName(series: Series): string {
	return series.label ?? series.data_key;
}

function defaultSeriesType(chartType: string): NonNullable<Series['series_type']> {
	if (chartType.includes('line')) {
		return 'line';
	}
	return chartType.includes('area') ? 'area' : 'bar';
}

function columnKind(rows: Record<string, unknown>[], name: string): ChartColumns[number]['kind'] {
	const value = rows.map((row) => row[name]).find((item) => item !== null && item !== undefined);
	if (typeof value === 'number' || typeof value === 'bigint') {
		return 'number';
	}
	if (value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))) {
		return 'date';
	}
	return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? 'number' : 'text';
}
