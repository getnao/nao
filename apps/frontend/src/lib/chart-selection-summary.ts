import { resolveDataKey } from '@nao/shared';
import { chartTypeRequiresXAxisKey, isPieChart } from '@nao/shared/chart-types';
import type { ChartType } from '@nao/shared/chart-types';
import type { displayChart } from '@nao/shared/tools';

export type ColumnValueKind = 'number' | 'date' | 'boolean' | 'text' | 'empty' | 'mixed';

export interface ColumnProfile {
	column: string;
	exists: boolean;
	kind: ColumnValueKind;
	distinctCount: number;
	nullCount: number;
}

export interface ChartSelectionSeries {
	label: string;
	color: string;
	profile: ColumnProfile;
}

export interface ChartSelectionSummary {
	xAxis: ColumnProfile | null;
	series: ChartSelectionSeries[];
	issues: string[];
}

type EditableChartInput = Omit<displayChart.KpiCardInput, 'chart_type'> & { chart_type: ChartType };

const ISO_DATE_RE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;

export function summarizeChartSelection(
	config: EditableChartInput,
	data: Record<string, unknown>[],
	palette: string[],
): ChartSelectionSummary {
	const xAxis = config.x_axis_key ? profileColumn(data, config.x_axis_key) : null;
	const series = config.series.map((entry, index) => describeSeries(entry, index, data, palette));
	return {
		xAxis,
		series,
		issues: collectIssues(config, xAxis, series, data.length),
	};
}

export function profileColumn(data: Record<string, unknown>[], column: string): ColumnProfile {
	const resolved = resolveDataKey(data, column);
	const exists = data.length > 0 && Object.prototype.hasOwnProperty.call(data[0], resolved);
	const values = exists ? data.map((row) => row[resolved]) : [];
	const present = values.filter((value) => value !== null && value !== undefined && value !== '');
	return {
		column: resolved,
		exists,
		kind: detectKind(present),
		distinctCount: new Set(present.map((value) => String(value))).size,
		nullCount: values.length - present.length,
	};
}

function describeSeries(
	entry: displayChart.SeriesConfig,
	index: number,
	data: Record<string, unknown>[],
	palette: string[],
): ChartSelectionSeries {
	const profile = profileColumn(data, entry.data_key);
	return {
		label: entry.label || profile.column,
		color: entry.color || palette[index % Math.max(palette.length, 1)] || '#888888',
		profile,
	};
}

function collectIssues(
	config: EditableChartInput,
	xAxis: ColumnProfile | null,
	series: ChartSelectionSeries[],
	rowCount: number,
): string[] {
	const issues: string[] = [];
	if (rowCount === 0) {
		issues.push('The query returned no rows, so the chart has nothing to draw.');
	}
	if (series.length === 0) {
		issues.push('Add at least one series to plot a value.');
	}
	if (!xAxis && chartTypeRequiresXAxisKey(config.chart_type)) {
		issues.push('This chart type needs an X axis column.');
	}
	if (xAxis && !xAxis.exists && rowCount > 0) {
		issues.push(`Column "${xAxis.column}" is not in the query result.`);
	} else if (xAxis?.exists && xAxis.kind === 'empty' && rowCount > 0) {
		issues.push(`X axis column "${xAxis.column}" has no values.`);
	}
	const xAxisValueCount = xAxis ? rowCount - xAxis.nullCount : 0;
	if (xAxis?.exists && xAxis.distinctCount < xAxisValueCount && !isPieChart(config.chart_type)) {
		issues.push(
			`"${xAxis.column}" repeats across rows (${xAxis.distinctCount} distinct values for ${xAxisValueCount} rows); points sharing a value are drawn on top of each other.`,
		);
	}
	for (const { label, profile } of series) {
		if (rowCount > 0 && !profile.exists) {
			issues.push(`Series column "${profile.column}" is not in the query result.`);
		} else if (rowCount > 0 && profile.kind === 'empty') {
			issues.push(`Series "${label}" has no values to plot.`);
		} else if (profile.exists && profile.kind !== 'number' && profile.kind !== 'empty') {
			issues.push(
				`Series "${label}" uses "${profile.column}", which holds ${profile.kind} values rather than numbers.`,
			);
		}
	}
	if (isPieChart(config.chart_type) && series.length > 1) {
		issues.push('Pie and donut charts only draw the first series.');
	}
	return issues;
}

function detectKind(values: unknown[]): ColumnValueKind {
	if (values.length === 0) {
		return 'empty';
	}
	const kinds = new Set(values.map(detectValueKind));
	if (kinds.size === 1) {
		return [...kinds][0];
	}
	return 'mixed';
}

function detectValueKind(value: unknown): ColumnValueKind {
	if (typeof value === 'number' || typeof value === 'bigint') {
		return 'number';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (value instanceof Date) {
		return 'date';
	}
	if (typeof value === 'string') {
		if (ISO_DATE_RE.test(value)) {
			return 'date';
		}
		if (value.trim() !== '' && !Number.isNaN(Number(value))) {
			return 'number';
		}
	}
	return 'text';
}
