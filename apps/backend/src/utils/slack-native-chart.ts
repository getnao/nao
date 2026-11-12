import { bucketPieData, labelize, resolveDataKey, sortByDateKey } from '@nao/shared';
import type { DateFormatSettings } from '@nao/shared/date';
import type { displayChart } from '@nao/shared/tools';
import {
	type CardChild,
	Chart,
	type ChartDefinition,
	type ChartElement,
	type ChartSegment,
	type ChartSeries,
	type PieChartDefinition,
	type SeriesChartDefinition,
} from 'chat';

import { truncateLabel } from './generate-chart';

const SLACK_CHART_MAX_PER_MESSAGE = 2;
const SLACK_CHART_MAX_TITLE_CHARS = 50;
const SLACK_CHART_MAX_LABEL_CHARS = 20;
const SLACK_CHART_MAX_SERIES = 12;
const SLACK_CHART_MAX_SEGMENTS = 12;
const SLACK_CHART_MAX_CATEGORIES = 20;

const SLACK_CHART_TYPES: Partial<Record<string, ChartDefinition['type']>> = {
	bar: 'bar',
	line: 'line',
	area: 'area',
	pie: 'pie',
	donut: 'pie',
};

type Row = Record<string, unknown>;
type ChartConfig = Pick<
	displayChart.KpiCardInput,
	'chart_type' | 'title' | 'x_axis_key' | 'x_axis_type' | 'x_axis_label' | 'y_axis_label' | 'series'
>;

export interface SlackNativeChartInput {
	config: ChartConfig;
	data: Row[];
	dateFormat?: DateFormatSettings | null;
}

/**
 * Builds a hoverable Slack chart (Block Kit `data_visualization`), or returns null when the chart
 * cannot be drawn faithfully within Slack's limits so the caller can fall back to a PNG.
 */
export function buildSlackNativeChart({ config, data, dateFormat }: SlackNativeChartInput): ChartElement | null {
	const chartType = SLACK_CHART_TYPES[config.chart_type];
	const title = fitText(config.title, SLACK_CHART_MAX_TITLE_CHARS);
	if (!chartType || !title || data.length === 0) {
		return null;
	}

	const xAxisKey = resolveDataKey(data, config.x_axis_key);
	const series = config.series.map((s) => ({ ...s, data_key: resolveDataKey(data, s.data_key) }));
	const rows = config.x_axis_type === 'date' ? sortByDateKey(data, xAxisKey) : data;
	const labelFor = (value: unknown) => fitText(labelize(value ?? '', dateFormat), SLACK_CHART_MAX_LABEL_CHARS);

	const chart =
		chartType === 'pie'
			? buildPieChart(rows, xAxisKey, series[0]?.data_key, labelFor)
			: buildSeriesChart(chartType, rows, xAxisKey, series, labelFor, config);
	return chart ? Chart({ title, chart }) : null;
}

export function hasRoomForSlackNativeChart(blocks: CardChild[]): boolean {
	return blocks.filter((block) => block.type === 'chart').length < SLACK_CHART_MAX_PER_MESSAGE;
}

function buildPieChart(
	rows: Row[],
	categoryKey: string,
	valueKey: string | undefined,
	labelFor: (value: unknown) => string | null,
): PieChartDefinition | null {
	if (!valueKey) {
		return null;
	}
	const numericRows = rows.map((row) => ({ [categoryKey]: row[categoryKey], [valueKey]: toNumber(row[valueKey]) }));
	if (numericRows.some((row) => !isNonNegative(row[valueKey]))) {
		return null;
	}

	const segments: ChartSegment[] = [];
	for (const slice of bucketPieData(numericRows, categoryKey, valueKey, SLACK_CHART_MAX_SEGMENTS - 1)) {
		const value = slice[valueKey] as number;
		const label = labelFor(slice[categoryKey]);
		if (!label) {
			return null;
		}
		if (value > 0) {
			segments.push({ label, value });
		}
	}
	if (segments.length === 0) {
		return null;
	}
	return { type: 'pie', segments };
}

function buildSeriesChart(
	chartType: SeriesChartDefinition['type'],
	rows: Row[],
	xAxisKey: string,
	series: displayChart.SeriesConfig[],
	labelFor: (value: unknown) => string | null,
	config: ChartConfig,
): SeriesChartDefinition | null {
	if (rows.length > SLACK_CHART_MAX_CATEGORIES || series.length > SLACK_CHART_MAX_SERIES) {
		return null;
	}
	const categories = rows.map((row) => labelFor(row[xAxisKey]));
	if (!areUniqueLabels(categories)) {
		return null;
	}

	const chartSeries: ChartSeries[] = [];
	for (const s of series) {
		const values = rows.map((row) => toNumber(row[s.data_key]));
		const name = fitText(s.label || labelize(s.data_key), SLACK_CHART_MAX_LABEL_CHARS);
		if (!name || values.some((value) => value === null)) {
			return null;
		}
		chartSeries.push({ name, data: categories.map((label, index) => ({ label, value: values[index] as number })) });
	}
	if (!areUniqueLabels(chartSeries.map((s) => s.name))) {
		return null;
	}

	return {
		type: chartType,
		categories,
		series: chartSeries,
		xLabel: fitText(config.x_axis_label, SLACK_CHART_MAX_TITLE_CHARS) ?? undefined,
		yLabel: fitText(config.y_axis_label, SLACK_CHART_MAX_TITLE_CHARS) ?? undefined,
	};
}

/** Slack counts UTF-16 units, so labels whose truncation still exceeds the limit (emoji) are rejected. */
function fitText(text: string | null | undefined, maxChars: number): string | null {
	const trimmed = text?.trim();
	if (!trimmed) {
		return null;
	}
	const fitted = truncateLabel(trimmed, maxChars);
	return fitted.length <= maxChars ? fitted : null;
}

function areUniqueLabels(labels: (string | null)[]): labels is string[] {
	return labels.every((label) => label !== null) && new Set(labels).size === labels.length;
}

function isNonNegative(value: unknown): boolean {
	return typeof value === 'number' && value >= 0;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'bigint') {
		return Number(value);
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
