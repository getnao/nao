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
	min?: number;
	max?: number;
	sum?: number;
	first?: string;
	last?: string;
}

export interface ChartSelectionXAxis {
	label: string;
	axisType: 'date' | 'number' | 'category';
	profile: ColumnProfile;
}

export interface ChartSelectionSeries {
	column: string;
	label: string;
	color: string;
	seriesType?: displayChart.SeriesType;
	yAxis: 'left' | 'right';
	isTotal: boolean;
	formatDescription?: string;
	profile: ColumnProfile;
}

export interface ChartSelectionSummary {
	chartLabel: string;
	rowCount: number;
	xAxis: ChartSelectionXAxis | null;
	series: ChartSelectionSeries[];
	issues: string[];
}

type EditableChartInput = Omit<displayChart.KpiCardInput, 'chart_type'> & { chart_type: ChartType };

const CHART_TYPE_LABELS: Record<ChartType, string> = {
	bar: 'Bar chart',
	stacked_bar: 'Stacked bar chart',
	stacked_bar_100: 'Stacked bar chart (100%)',
	horizontal_bar: 'Horizontal bar chart',
	horizontal_bar_100: 'Horizontal bar chart (100%)',
	line: 'Line chart',
	area: 'Area chart',
	stacked_area: 'Stacked area chart',
	stacked_area_100: 'Stacked area chart (100%)',
	mixed: 'Mixed chart',
	pie: 'Pie chart',
	donut: 'Donut chart',
	kpi_card: 'KPI card',
	scatter: 'Scatter plot',
	radar: 'Radar chart',
};

const ISO_DATE_RE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;

export function summarizeChartSelection(
	config: EditableChartInput,
	data: Record<string, unknown>[],
	palette: string[],
): ChartSelectionSummary {
	const xAxis = describeXAxis(config, data);
	const series = config.series.map((entry, index) => describeSeries(entry, index, data, palette));
	return {
		chartLabel: CHART_TYPE_LABELS[config.chart_type] ?? config.chart_type,
		rowCount: data.length,
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
	const kind = detectKind(present);
	const profile: ColumnProfile = {
		column: resolved,
		exists,
		kind,
		distinctCount: new Set(present.map((value) => String(value))).size,
		nullCount: values.length - present.length,
	};
	if (kind === 'number') {
		const numbers = present.map((value) => Number(value));
		profile.min = Math.min(...numbers);
		profile.max = Math.max(...numbers);
		profile.sum = numbers.reduce((total, value) => total + value, 0);
	}
	if (present.length > 0 && kind !== 'number') {
		profile.first = String(present[0]);
		profile.last = String(present[present.length - 1]);
	}
	return profile;
}

export function describeValueFormat(format: displayChart.ValueFormat | undefined): string | undefined {
	if (!format) {
		return undefined;
	}
	const parts: string[] = [];
	if (format.prefix) {
		parts.push(`prefix "${format.prefix}"`);
	}
	if (format.suffix) {
		parts.push(`suffix "${format.suffix}"`);
	}
	if (format.d3_format) {
		parts.push(`number format ${format.d3_format}`);
	}
	return parts.length > 0 ? parts.join(', ') : undefined;
}

function describeXAxis(config: EditableChartInput, data: Record<string, unknown>[]): ChartSelectionXAxis | null {
	if (!config.x_axis_key) {
		return null;
	}
	const profile = profileColumn(data, config.x_axis_key);
	return {
		label: config.x_axis_label || profile.column,
		axisType: resolveAxisType(config.x_axis_type, profile.kind),
		profile,
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
		column: profile.column,
		label: entry.label || profile.column,
		color: entry.color || palette[index % Math.max(palette.length, 1)] || '#888888',
		seriesType: entry.series_type,
		yAxis: entry.y_axis === 'right' ? 'right' : 'left',
		isTotal: entry.is_total === true,
		formatDescription: describeValueFormat(entry.value_format),
		profile,
	};
}

function collectIssues(
	config: EditableChartInput,
	xAxis: ChartSelectionXAxis | null,
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
	if (xAxis && !xAxis.profile.exists && rowCount > 0) {
		issues.push(`Column "${xAxis.profile.column}" is not in the query result.`);
	}
	if (xAxis?.profile.exists && xAxis.profile.distinctCount < rowCount && !isPieChart(config.chart_type)) {
		issues.push(
			`"${xAxis.profile.column}" repeats across rows (${xAxis.profile.distinctCount} distinct values for ${rowCount} rows); points sharing a value are drawn on top of each other.`,
		);
	}
	for (const entry of series) {
		if (!entry.profile.exists && rowCount > 0) {
			issues.push(`Series column "${entry.column}" is not in the query result.`);
		} else if (entry.profile.exists && entry.profile.kind !== 'number' && entry.profile.kind !== 'empty') {
			issues.push(
				`Series "${entry.label}" uses "${entry.column}", which holds ${entry.profile.kind} values rather than numbers.`,
			);
		}
	}
	if (isPieChart(config.chart_type) && series.length > 1) {
		issues.push('Pie and donut charts only draw the first series.');
	}
	return issues;
}

function resolveAxisType(
	configured: displayChart.XAxisType | null | undefined,
	kind: ColumnValueKind,
): 'date' | 'number' | 'category' {
	if (configured === 'date' || configured === 'number') {
		return configured;
	}
	if (configured === 'category') {
		return 'category';
	}
	if (kind === 'date') {
		return 'date';
	}
	return kind === 'number' ? 'number' : 'category';
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
