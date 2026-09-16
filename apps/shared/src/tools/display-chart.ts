import z from 'zod/v3';

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

export const ChartTypeEnum = z.enum(BUILTIN_CHART_TYPES);

const ChartTypeNameSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]*$/, 'Chart type must use lowercase letters, numbers, underscores, or hyphens.');
const CustomChartTypeSchema = ChartTypeNameSchema.refine(
	(type) => !isNativeDisplayType(type),
).brand<'CustomChartType'>();
const ChartTypeSchema = z.union([ChartTypeEnum, CustomChartTypeSchema]);

export const XAxisTypeEnum = z.enum(['date', 'number', 'category']);

export const ValueFormatSchema = z.object({
	d3_format: z
		.string()
		.describe(
			'd3-format specifier applied to the number as-is, such as ",.2f", ".1f", ",.0f", or ".2s". Do not use d3\'s "%" type: for a percentage already stored as 42.5, use { d3_format: ".1f", suffix: "%" } so the value is not multiplied by 100.',
		)
		.optional(),
	compact: z
		.enum(['financial', 'si'])
		.describe(
			'How d3 SI-prefix "s" output is displayed. Defaults to "financial", which maps k to K and G to B while leaving M and T unchanged. Use "si" for scientific units such as bytes so d3 letters remain unchanged.',
		)
		.optional(),
	prefix: z
		.string()
		.describe(
			'Free text placed before the number. Use for any currency symbol, such as "$", "€", "¥", or "£". Example USD money: { d3_format: ",.2f", prefix: "$", compact: "financial" }.',
		)
		.optional(),
	suffix: z
		.string()
		.describe(
			'Free text placed after the number. Use for percentages and any unit. Examples: { d3_format: ".1f", suffix: "%" } for 42.5 as 42.5%; { d3_format: ",.0f", suffix: " V" } for volts; { d3_format: ".2s", suffix: "B", compact: "si" } for bytes.',
		)
		.optional(),
});

export const ComparisonModeEnum = z.enum(['percentage', 'variation', 'absolute', 'none']);
export type ComparisonMode = z.infer<typeof ComparisonModeEnum>;

const COMPARISON_MODE_DESCRIPTION =
	'KPI cards only: shows a change pill comparing the latest value to the previous period ("percentage", "variation", "absolute", or "none" to hide). Requires the query to return 2+ time-ordered rows (oldest → newest).';
export const SeriesTypeEnum = z.enum(['bar', 'line', 'area']);

export const YAxisSideEnum = z.enum(['left', 'right']);

export const SeriesConfigSchema = z.object({
	data_key: z.string().describe('Column name from SQL result to plot.'),
	color: z.string().describe('CSS color (defaults to theme colors).').optional(),
	label: z.string().describe('Label to display in the legend.').optional(),
	value_format: ValueFormatSchema.describe(
		'Controls how this series\' numeric values render on the axis, tooltip, data labels, and KPI card. The number is formatted as-is: use prefix for any currency symbol and suffix for percentages or units; never use d3\'s "%" type because it multiplies by 100. Examples: USD { d3_format: ",.2f", prefix: "$", compact: "financial" }; percentage stored as 42.5 { d3_format: ".1f", suffix: "%" }; volts { d3_format: ",.0f", suffix: " V" }; bytes { d3_format: ".2s", suffix: "B", compact: "si" }.',
	).optional(),
	is_total: z
		.boolean()
		.describe(
			'Set to true when this series is an already-aggregated total of the other series (e.g. a grand total, rollup, subtotal, or sum-of-parts column), so the tooltip must not sum it again. Decide this from the meaning of the column, not its name — it applies in any language.',
		)
		.optional(),
	series_type: SeriesTypeEnum.describe(
		'How this series is drawn ("bar", "line" or "area"). Only used when chart_type is "mixed"; defaults to "bar". Use it to combine types in one chart, e.g. bars for revenue and a line for a rate.',
	).optional(),
	y_axis: YAxisSideEnum.describe(
		'Which Y-axis this series is plotted against ("left" or "right"). Only used when chart_type is "mixed"; defaults to "left". A right axis is drawn whenever any series uses "right" — use it to compare metrics with very different scales/units.',
	).optional(),
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

export const ChartInputObjectSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: ChartTypeSchema.describe('Built-in chart type or an available project custom chart type.'),
	x_axis_key: z.string().describe('Column name for X-axis/category labels.'),
	x_axis_type: XAxisTypeEnum.nullable().describe(
		'Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
	),
	x_axis_label: z
		.string()
		.describe('Title displayed alongside the X-axis. Leave unset to show no axis title.')
		.optional(),
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series (at least one series required).'),
	y_axis_min: z
		.number()
		.describe(
			'Fixes the left Y-axis lower bound. Leave unset to auto-scale for readability (line and scatter charts do not force a zero baseline).',
		)
		.optional(),
	y_axis_max: z.number().describe('Fixes the left Y-axis upper bound. Leave unset to auto-scale.').optional(),
	y_axis_label: z
		.string()
		.describe('Title displayed alongside the left Y-axis. Leave unset to show no axis title.')
		.optional(),
	y_axis_right_min: z
		.number()
		.describe(
			'Fixes the right Y-axis lower bound. Only used when chart_type is "mixed"; leave unset to auto-scale.',
		)
		.optional(),
	y_axis_right_max: z
		.number()
		.describe(
			'Fixes the right Y-axis upper bound. Only used when chart_type is "mixed"; leave unset to auto-scale.',
		)
		.optional(),
	y_axis_right_label: z
		.string()
		.describe('Label displayed alongside the right Y-axis. Only used when chart_type is "mixed".')
		.optional(),
	show_data_labels: z
		.boolean()
		.describe(
			'Show the numeric value of each data point directly on the chart. Set to true when the user asks to display values/data labels on the chart.',
		)
		.optional(),
	hide_total: z
		.boolean()
		.describe(
			'Set to true when the chart\'s series must NOT be added together into a single grand total — e.g. they are unrelated metrics, in different units, or different currencies, so a combined total would be meaningless. When true, the hover tooltip omits the "Total" row. Leave unset when the series are additive parts of the same measure (a total then makes sense). This is a chart-wide setting; for a single series that is itself an aggregated total of the others, use the per-series is_total flag instead.',
		)
		.optional(),
	title: z
		.string()
		.describe(
			'A concise and descriptive title of what the chart shows. Do not include the type of chart in the title or other chart configurations.',
		),
});

const leftYAxisBoundsValid = (input: { y_axis_min?: number; y_axis_max?: number }) =>
	input.y_axis_min === undefined || input.y_axis_max === undefined || input.y_axis_min < input.y_axis_max;
const rightYAxisBoundsValid = (input: { y_axis_right_min?: number; y_axis_right_max?: number }) =>
	input.y_axis_right_min === undefined ||
	input.y_axis_right_max === undefined ||
	input.y_axis_right_min < input.y_axis_right_max;
const LEFT_Y_AXIS_BOUNDS_MESSAGE = { message: 'The left Y-axis minimum must be less than the maximum.' };
const RIGHT_Y_AXIS_BOUNDS_MESSAGE = { message: 'The right Y-axis minimum must be less than the maximum.' };

export const ChartInputSchema = ChartInputObjectSchema.refine(leftYAxisBoundsValid, LEFT_Y_AXIS_BOUNDS_MESSAGE).refine(
	rightYAxisBoundsValid,
	RIGHT_Y_AXIS_BOUNDS_MESSAGE,
);

/** KPI cards render a single headline number and have no axes, so they may omit the x-axis fields. */
const KpiCardInputSchema = ChartInputObjectSchema.extend({
	x_axis_key: z.string().describe('Column name for X-axis/category labels.').optional(),
	x_axis_type: XAxisTypeEnum.nullable()
		.describe(
			'Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
		)
		.optional(),
	comparison_mode: ComparisonModeEnum.describe(COMPARISON_MODE_DESCRIPTION).optional(),
})
	.refine(leftYAxisBoundsValid, LEFT_Y_AXIS_BOUNDS_MESSAGE)
	.refine(rightYAxisBoundsValid, RIGHT_Y_AXIS_BOUNDS_MESSAGE);

export const TableInputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: z.literal('table').describe('Display the SQL result as a table.'),
	title: z.string().describe('A concise, descriptive title of what the table shows.').optional(),
	conditional_formats: ColumnConditionalFormatsSchema.optional(),
});

export type ChartInput = z.infer<typeof ChartInputSchema>;
export type KpiCardInput = z.infer<typeof KpiCardInputSchema>;
export type TableInput = z.infer<typeof TableInputSchema>;
export type Input = ChartInput | KpiCardInput | TableInput;

const DisplayTypeSchema = z.union([ChartTypeSchema, z.literal('table')]);

const BaseInputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	chart_type: DisplayTypeSchema.describe(
		'Type of visualization to display. Use "table" for tabular results or an available custom chart type.',
	),
	x_axis_key: z.string().describe('Column name for X-axis/category labels. Required for charts.').optional(),
	x_axis_type: XAxisTypeEnum.nullable()
		.describe(
			'Required for charts. Use "date" only when x-axis values parse as JS Date (YYYY-MM-DD). Use "category" for quarter_ending, fiscal periods, or labels. Use "number" for numeric x-axis.',
		)
		.optional(),
	x_axis_label: ChartInputObjectSchema.shape.x_axis_label,
	series: z
		.array(SeriesConfigSchema)
		.min(1)
		.describe('Columns to plot as data series. Required for charts and omitted for tables.')
		.optional(),
	comparison_mode: ComparisonModeEnum.describe(COMPARISON_MODE_DESCRIPTION).optional(),
	y_axis_min: ChartInputObjectSchema.shape.y_axis_min,
	y_axis_max: ChartInputObjectSchema.shape.y_axis_max,
	y_axis_label: ChartInputObjectSchema.shape.y_axis_label,
	y_axis_right_min: ChartInputObjectSchema.shape.y_axis_right_min,
	y_axis_right_max: ChartInputObjectSchema.shape.y_axis_right_max,
	y_axis_right_label: ChartInputObjectSchema.shape.y_axis_right_label,
	show_data_labels: ChartInputObjectSchema.shape.show_data_labels,
	hide_total: z
		.boolean()
		.describe(
			'Set to true when the chart\'s series must NOT be added together into a single grand total — e.g. they are unrelated metrics, in different units, or different currencies, so a combined total would be meaningless. When true, the hover tooltip omits the "Total" row. Leave unset when the series are additive parts of the same measure (a total then makes sense). This is a chart-wide setting; for a single series that is itself an aggregated total of the others, use the per-series is_total flag instead.',
		)
		.optional(),
	title: z.string().describe('A concise, descriptive title for the visualization. Required for charts.').optional(),
	conditional_formats: ColumnConditionalFormatsSchema.describe(
		'Conditional formatting rules for table columns. Only used when chart_type is "table".',
	).optional(),
});

export const InputSchema = BaseInputSchema.superRefine((input, context) => {
	const result =
		input.chart_type === 'table'
			? TableInputSchema.safeParse(input)
			: input.chart_type === 'kpi_card'
				? KpiCardInputSchema.safeParse(input)
				: ChartInputSchema.safeParse(input);
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
export type ValueFormat = z.infer<typeof ValueFormatSchema>;
export type SeriesType = z.infer<typeof SeriesTypeEnum>;
export type YAxisSide = z.infer<typeof YAxisSideEnum>;
export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;
export type ColorScaleRule = z.infer<typeof ColorScaleRuleSchema>;
export type ThresholdRule = z.infer<typeof ThresholdRuleSchema>;
export type BooleanRule = z.infer<typeof BooleanRuleSchema>;
export type StringRule = z.infer<typeof StringRuleSchema>;
export type ConditionalFormatRule = z.infer<typeof ConditionalFormatRuleSchema>;
export type ColumnConditionalFormats = z.infer<typeof ColumnConditionalFormatsSchema>;
export type Output = z.infer<typeof OutputSchema>;

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

export type BuiltinChartInput = Omit<ChartInput, 'chart_type'> & { chart_type: ChartType };

export function isBuiltinChartType(type: string): type is ChartType {
	return (BUILTIN_CHART_TYPES as readonly string[]).includes(type);
}

/** Display types nao renders natively (as opposed to project-defined custom charts): builtins plus `table`. */
export function isNativeDisplayType(type: string): boolean {
	return type === 'table' || isBuiltinChartType(type);
}

export function isTableInput(input: Input): input is TableInput {
	return input.chart_type === 'table';
}

export function isChartInput(input: Input): input is ChartInput | KpiCardInput {
	return !isTableInput(input);
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

const AXIS_LABEL_UNSUPPORTED_CHART_TYPES = new Set<ChartType>([
	'pie',
	'donut',
	'kpi_card',
	'radar',
	'horizontal_bar',
	'horizontal_bar_100',
]);

export function chartTypeSupportsAxisLabels(type: string): boolean {
	return isBuiltinChartType(type) && !AXIS_LABEL_UNSUPPORTED_CHART_TYPES.has(type);
}

export function resolveShowDataLabels(type: string, showDataLabels?: boolean): boolean {
	return showDataLabels ?? type === 'horizontal_bar';
}

export function chartTypeSupportsComboSeries(type: ChartType): boolean {
	return type === 'mixed';
}

export function hasRightAxisSeries(series: Pick<SeriesConfig, 'y_axis'>[]): boolean {
	return series.some((s) => s.y_axis === 'right');
}

export function isComboChart(type: ChartType): boolean {
	return chartTypeSupportsComboSeries(type);
}
