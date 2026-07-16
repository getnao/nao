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

export const ColorScaleRuleSchema = z.object({
	type: z.literal('color-scale'),
	color: z
		.string()
		.describe(
			'Main color of the scale; the gradient runs from a light tint of it (low) to it (high). Use hex, rgb(), rgba(), hsl(), hsla() or a common CSS color name.',
		)
		.optional(),
	minColor: z
		.string()
		.describe('Color for the lowest value (overrides the derived tint). Hex, rgb(), rgba(), hsl(), hsla() or name.')
		.optional(),
	maxColor: z
		.string()
		.describe(
			'Color for the highest value (overrides the derived color). Hex, rgb(), rgba(), hsl(), hsla() or name.',
		)
		.optional(),
	min: z.number().describe('Explicit lower bound of the scale; defaults to the column minimum.').optional(),
	max: z.number().describe('Explicit upper bound of the scale; defaults to the column maximum.').optional(),
});

export const ThresholdRuleSchema = z.object({
	type: z.literal('threshold'),
	operator: z.enum(['>=', '>', '<=', '<', '=']).describe('Comparison applied to each cell value.'),
	value: z.number().describe('Value to compare each cell against.'),
	color: z.string().describe('CSS background color applied when the comparison passes.'),
});

export const BooleanRuleSchema = z.object({
	type: z.literal('boolean'),
	trueColor: z.string().describe('Background color for true cells (omit for none).').optional(),
	falseColor: z.string().describe('Background color for false cells (omit for none).').optional(),
});

export const StringRuleSchema = z.object({
	type: z.literal('string'),
	operator: z
		.enum(['equals', 'in', 'like'])
		.describe('"equals": exact match; "in": value is one of a list; "like": case-insensitive substring.'),
	value: z
		.union([z.string(), z.array(z.string())])
		.describe('A single string for "equals"/"like", or an array of strings for "in".'),
	color: z.string().describe('CSS background color applied when the cell matches.'),
});

export const ConditionalFormatRuleSchema = z.discriminatedUnion('type', [
	ColorScaleRuleSchema,
	ThresholdRuleSchema,
	BooleanRuleSchema,
	StringRuleSchema,
]);

export const ColumnConditionalFormatsSchema = z
	.record(z.string(), ConditionalFormatRuleSchema)
	.describe('Map of column name to the conditional-formatting rule applied to that column.');

export const ChartInputSchema = z
	.object({
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
		y_axis_min: z
			.number()
			.describe(
				'Fixes the Y-axis lower bound. Leave unset to auto-scale for readability (line and scatter charts do not force a zero baseline).',
			)
			.optional(),
		y_axis_max: z.number().describe('Fixes the Y-axis upper bound. Leave unset to auto-scale.').optional(),
		show_data_labels: z
			.boolean()
			.describe(
				'Show the numeric value of each data point directly on the chart. Set to true when the user asks to display values/data labels on the chart.',
			)
			.optional(),
		title: z
			.string()
			.describe(
				'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
			),
	})
	.refine(
		(input) =>
			input.y_axis_min === undefined || input.y_axis_max === undefined || input.y_axis_min < input.y_axis_max,
		{
			message: 'The Y-axis minimum must be less than the maximum.',
		},
	);

export const TableInputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: z.literal('table').describe('Display the SQL result as a table.'),
	title: z.string().describe('A concise, descriptive title of what the table shows.').optional(),
	conditional_formats: ColumnConditionalFormatsSchema.optional(),
});

export type ChartInput = z.infer<typeof ChartInputSchema>;
export type TableInput = z.infer<typeof TableInputSchema>;
export type Input = ChartInput | TableInput;

const DisplayTypeEnum = z.enum([...ChartTypeEnum.options, 'table']);

const BaseInputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: DisplayTypeEnum.describe('Type of visualization to display. Use "table" for tabular results.'),
	x_axis_key: z.string().describe('Column name for X-axis/category labels. Required for charts.').optional(),
	x_axis_type: XAxisTypeEnum.nullable()
		.describe(
			'Required for charts. Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
		)
		.optional(),
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series. Required for charts and omitted for tables.')
		.optional(),
	title: z.string().describe('A concise, descriptive title for the visualization. Required for charts.').optional(),
	conditional_formats: ColumnConditionalFormatsSchema.describe(
		'Conditional formatting rules for table columns. Only used when chart_type is "table".',
	).optional(),
});

export const InputSchema = BaseInputSchema.superRefine((input, context) => {
	const result = input.chart_type === 'table' ? TableInputSchema.safeParse(input) : ChartInputSchema.safeParse(input);
	if (result.success) {
		return;
	}
	for (const issue of result.error.issues) {
		context.addIssue(issue);
	}
}) as z.ZodType<Input>;

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
});

export type ChartType = z.infer<typeof ChartTypeEnum>;
export type XAxisType = z.infer<typeof XAxisTypeEnum>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type ColorScaleRule = z.infer<typeof ColorScaleRuleSchema>;
export type ThresholdRule = z.infer<typeof ThresholdRuleSchema>;
export type BooleanRule = z.infer<typeof BooleanRuleSchema>;
export type StringRule = z.infer<typeof StringRuleSchema>;
export type ConditionalFormatRule = z.infer<typeof ConditionalFormatRuleSchema>;
export type ColumnConditionalFormats = z.infer<typeof ColumnConditionalFormatsSchema>;
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
