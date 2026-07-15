import z from 'zod/v3';

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

export const InputSchema = z.object({
	query_id: z.string().describe("The id of a previous `execute_sql` tool call's output to get data from."),
	title: z.string().describe('A concise, descriptive title of what the table shows.').optional(),
	conditional_formats: ColumnConditionalFormatsSchema.optional(),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.boolean(),
	error: z.string().optional(),
});

export type ColorScaleRule = z.infer<typeof ColorScaleRuleSchema>;
export type ThresholdRule = z.infer<typeof ThresholdRuleSchema>;
export type BooleanRule = z.infer<typeof BooleanRuleSchema>;
export type StringRule = z.infer<typeof StringRuleSchema>;
export type ConditionalFormatRule = z.infer<typeof ConditionalFormatRuleSchema>;
export type ColumnConditionalFormats = z.infer<typeof ColumnConditionalFormatsSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
