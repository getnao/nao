import z from 'zod/v3';

export const ChartTypeEnum = z.enum([
	'bar',
	'stacked_bar',
	'stacked_bar_100',
	'line',
	'area',
	'stacked_area',
	'stacked_area_100',
	'pie',
	'donut',
	'kpi_card',
	'scatter',
	'radar',
]);

export const XAxisTypeEnum = z.enum(['date', 'number', 'category']);

export const SeriesConfigSchema = z.object({
	data_key: z.string().describe('Column name from SQL result to plot.'),
	color: z.string().describe('CSS color (defaults to theme colors).').optional(),
	label: z.string().describe('Label to display in the legend.').optional(),
	is_total: z
		.boolean()
		.describe(
			'Set to true when this series is an already-aggregated total of the other series (e.g. a grand total, rollup, subtotal, or sum-of-parts column), so the tooltip must not sum it again. Decide this from the meaning of the column, not its name — it applies in any language.',
		)
		.optional(),
});

export const InputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: ChartTypeEnum.describe('Type of chart to display.'),
	x_axis_key: z.string().describe('Column name for X-axis/category labels.'),
	x_axis_type: XAxisTypeEnum.nullable().describe(
		'Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
	),
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series (at least one series required).'),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
		),
	show_data_labels: z
		.boolean()
		.describe(
			'Show the numeric value of each data point directly on the chart. Set to true when the user asks to display values/data labels on the chart.',
		)
		.optional(),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
});

export type ChartType = z.infer<typeof ChartTypeEnum>;
export type XAxisType = z.infer<typeof XAxisTypeEnum>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;

const STACKED_CHART_TYPES = new Set<ChartType>(['stacked_bar', 'stacked_bar_100', 'stacked_area', 'stacked_area_100']);
const PERCENT_STACKED_CHART_TYPES = new Set<ChartType>(['stacked_bar_100', 'stacked_area_100']);
const X_AXIS_REQUIRED_CHART_TYPES = new Set<ChartType>([
	'bar',
	'line',
	'area',
	'stacked_area',
	'stacked_area_100',
	'stacked_bar_100',
	'scatter',
	'radar',
]);

export function isStackedChartType(type: ChartType): boolean {
	return STACKED_CHART_TYPES.has(type);
}

export function isPercentStackedChartType(type: ChartType): boolean {
	return PERCENT_STACKED_CHART_TYPES.has(type);
}

export function chartTypeRequiresXAxisKey(type: ChartType): boolean {
	return X_AXIS_REQUIRED_CHART_TYPES.has(type);
}

export function isPieChart(chartType: ChartType): boolean {
	return chartType === 'pie' || chartType === 'donut';
}
