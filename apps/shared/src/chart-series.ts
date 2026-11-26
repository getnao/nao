import { useCallback, useMemo, useState } from 'react';

import { DEFAULT_COLORS, labelize, sortByDateKey } from './chart-builder';
import type { ChartConfig } from './chart-tooltip';
import { isPieChart, isStackedChartType } from './chart-types';
import { toFiniteNumber } from './chart-values';
import { isIsoDateLike } from './date';
import { resolveDataKey } from './map';
import type * as displayChart from './tools/display-chart';

export const SERIES_COLORS = DEFAULT_COLORS.map((_, index) => `var(--chart-${index + 1})`);

export const OTHER_BREAKDOWN_VALUE = 'Other';

type Row = Record<string, unknown>;

export interface ChartBreakdownInput {
	rows: Row[];
	chartType: string;
	xAxisKey: string;
	series: displayChart.SeriesConfig[];
	breakdownKey?: string;
	breakdownLimit?: number;
}

export function seriesColorAt(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
}

/**
 * Pivots long rows (one per x value and breakdown value) into one series per breakdown value,
 * so a value that appears in a later refresh becomes a new series without editing the chart.
 */
export function applyBreakdown(input: ChartBreakdownInput): { rows: Row[]; series: displayChart.SeriesConfig[] } {
	if (!input.breakdownKey || isPieChart(input.chartType) || input.rows.length === 0) {
		return { rows: input.rows, series: input.series };
	}
	const { rows } = input;
	const breakdownKey = resolveDataKey(rows, input.breakdownKey);
	const xAxisKey = resolveDataKey(rows, input.xAxisKey);
	const metrics = input.series.map((metric) => ({ ...metric, data_key: resolveDataKey(rows, metric.data_key) }));
	const values = listBreakdownValues(rows, { ...input, breakdownKey, xAxisKey, rankKey: metrics[0]?.data_key });
	const series = metrics.flatMap((metric, metricIndex) =>
		values.map((value, valueIndex) => ({
			...metric,
			data_key: breakdownSeriesKey(metricIndex, valueIndex),
			label: metrics.length > 1 ? `${metric.label || labelize(metric.data_key)} · ${value}` : value,
			color: undefined,
		})),
	);
	const missingValue = isStackedChartType(input.chartType) ? 0 : null;
	return { rows: pivotRows(rows, { xAxisKey, breakdownKey, metrics, values, missingValue }), series };
}

export function useSeriesVisibility(series: displayChart.SeriesConfig[]) {
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());

	const visibleSeries = useMemo(
		() => series.filter((s) => !hiddenSeriesKeys.has(s.data_key)),
		[series, hiddenSeriesKeys],
	);

	const handleToggleSeriesVisibility = useCallback((dataKey: string) => {
		setHiddenSeriesKeys((prev) => {
			const copy = new Set(prev);
			if (copy.has(dataKey)) {
				copy.delete(dataKey);
			} else {
				copy.add(dataKey);
			}
			return copy;
		});
	}, []);

	return {
		visibleSeries,
		hiddenSeriesKeys,
		handleToggleSeriesVisibility,
	};
}

export function buildSeriesChartConfig(
	series: displayChart.SeriesConfig[],
	labelFor: (dataKey: string) => string,
): ChartConfig {
	return series.reduce<ChartConfig>((acc, s, index) => {
		acc[s.data_key] = {
			label: s.label || labelFor(s.data_key),
			color: s.color || seriesColorAt(index),
			isTotal: s.is_total,
			valueFormat: s.value_format,
		};
		return acc;
	}, {});
}

export function buildSeriesLegendPayload(
	series: displayChart.SeriesConfig[],
	hiddenSeriesKeys: Set<string>,
	labelFor: (dataKey: string) => string,
) {
	return series.map((s, index) => ({
		value: s.label || labelFor(s.data_key),
		dataKey: s.data_key,
		color: s.color || seriesColorAt(index),
		isHidden: hiddenSeriesKeys.has(s.data_key),
	}));
}

function listBreakdownValues(rows: Row[], options: ChartBreakdownInput & { rankKey?: string }): string[] {
	const values = [...new Set(rows.map((row) => breakdownLabel(row[options.breakdownKey!])))].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true }),
	);
	const limit = options.breakdownLimit;
	if (!limit || values.length <= limit) {
		return values;
	}
	const kept = new Set(rankBreakdownValues(rows, options).slice(0, limit));
	return [...values.filter((value) => kept.has(value) && value !== OTHER_BREAKDOWN_VALUE), OTHER_BREAKDOWN_VALUE];
}

/** Time series keep the values largest in the latest period; other charts keep the largest totals. */
function rankBreakdownValues(rows: Row[], options: ChartBreakdownInput & { rankKey?: string }): string[] {
	const { xAxisKey, breakdownKey, rankKey } = options;
	const isTimeAxis = rows.every((row) => isIsoDateLike(row[xAxisKey]));
	const latestX = isTimeAxis ? String(sortByDateKey(rows, xAxisKey).at(-1)?.[xAxisKey]) : null;
	const scores = new Map<string, { latest: number; total: number }>();
	for (const row of rows) {
		const value = breakdownLabel(row[breakdownKey!]);
		const amount = rankKey ? (toFiniteNumber(row[rankKey]) ?? 0) : 0;
		const score = scores.get(value) ?? { latest: 0, total: 0 };
		score.total += amount;
		if (String(row[xAxisKey]) === latestX) {
			score.latest += amount;
		}
		scores.set(value, score);
	}
	return [...scores.entries()]
		.sort(([, a], [, b]) => b.latest - a.latest || b.total - a.total)
		.map(([value]) => value);
}

function pivotRows(
	rows: Row[],
	options: {
		xAxisKey: string;
		breakdownKey: string;
		metrics: displayChart.SeriesConfig[];
		values: string[];
		missingValue: number | null;
	},
): Row[] {
	const { xAxisKey, breakdownKey, metrics, values, missingValue } = options;
	const valueIndexes = new Map(values.map((value, index) => [value, index]));
	const otherIndex = valueIndexes.get(OTHER_BREAKDOWN_VALUE);
	const pivoted = new Map<string, Row>();
	for (const row of rows) {
		const x = row[xAxisKey];
		const target =
			pivoted.get(String(x)) ?? emptyPivotRow(xAxisKey, x, metrics.length, values.length, missingValue);
		pivoted.set(String(x), target);
		const valueIndex = valueIndexes.get(breakdownLabel(row[breakdownKey])) ?? otherIndex;
		if (valueIndex === undefined) {
			continue;
		}
		metrics.forEach((metric, metricIndex) => {
			const amount = toFiniteNumber(row[metric.data_key]);
			if (amount === null) {
				return;
			}
			const key = breakdownSeriesKey(metricIndex, valueIndex);
			target[key] = ((target[key] as number | null) ?? 0) + amount;
		});
	}
	return [...pivoted.values()];
}

function emptyPivotRow(
	xAxisKey: string,
	x: unknown,
	metricCount: number,
	valueCount: number,
	missingValue: number | null,
): Row {
	const row: Row = { [xAxisKey]: x };
	for (let metricIndex = 0; metricIndex < metricCount; metricIndex++) {
		for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) {
			row[breakdownSeriesKey(metricIndex, valueIndex)] = missingValue;
		}
	}
	return row;
}

function breakdownSeriesKey(metricIndex: number, valueIndex: number): string {
	return `breakdown_${metricIndex}_${valueIndex}`;
}

function breakdownLabel(value: unknown): string {
	return value === null || value === undefined || value === '' ? '(empty)' : String(value);
}
