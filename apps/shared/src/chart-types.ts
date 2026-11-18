export const BUILTIN_CHART_TYPES = [
	'bar',
	'stacked_bar',
	'stacked_bar_100',
	'horizontal_bar',
	'horizontal_bar_100',
	'line',
	'area',
	'stacked_area',
	'stacked_area_100',
	'mixed',
	'pie',
	'donut',
	'kpi_card',
	'scatter',
	'radar',
] as const;

export type ChartType = (typeof BUILTIN_CHART_TYPES)[number];

const STACKED_CHART_TYPES = new Set<ChartType>([
	'stacked_bar',
	'stacked_bar_100',
	'horizontal_bar',
	'horizontal_bar_100',
	'stacked_area',
	'stacked_area_100',
]);
const PERCENT_STACKED_CHART_TYPES = new Set<ChartType>(['stacked_bar_100', 'horizontal_bar_100', 'stacked_area_100']);
const X_AXIS_REQUIRED_CHART_TYPES = new Set<ChartType>([
	'bar',
	'horizontal_bar',
	'horizontal_bar_100',
	'line',
	'area',
	'stacked_area',
	'stacked_area_100',
	'stacked_bar_100',
	'mixed',
	'scatter',
	'radar',
]);

const AXIS_LABEL_UNSUPPORTED_CHART_TYPES = new Set<ChartType>([
	'pie',
	'donut',
	'kpi_card',
	'radar',
	'horizontal_bar',
	'horizontal_bar_100',
]);

export function isBuiltinChartType(type: string): type is ChartType {
	return (BUILTIN_CHART_TYPES as readonly string[]).includes(type);
}

export function isStackedChartType(type: string): boolean {
	return isBuiltinChartType(type) && STACKED_CHART_TYPES.has(type);
}

export function isPercentStackedChartType(type: string): boolean {
	return isBuiltinChartType(type) && PERCENT_STACKED_CHART_TYPES.has(type);
}

export function chartTypeRequiresXAxisKey(type: string): boolean {
	return !isBuiltinChartType(type) || X_AXIS_REQUIRED_CHART_TYPES.has(type);
}

export function isPieChart(chartType: string): boolean {
	return chartType === 'pie' || chartType === 'donut';
}

export function chartTypeSupportsAxisLabels(type: string): boolean {
	return isBuiltinChartType(type) && !AXIS_LABEL_UNSUPPORTED_CHART_TYPES.has(type);
}

export function resolveShowDataLabels(type: string, showDataLabels?: boolean): boolean {
	return showDataLabels ?? type === 'horizontal_bar';
}

export function chartTypeSupportsComboSeries(type: ChartType): boolean {
	return type === 'mixed';
}

export function isComboChart(type: ChartType): boolean {
	return chartTypeSupportsComboSeries(type);
}
