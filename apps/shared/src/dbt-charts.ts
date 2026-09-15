import z from 'zod/v3';

export const STORY_FORMATS = ['markdown', 'dbt_charts'] as const;
export type StoryFormat = (typeof STORY_FORMATS)[number];
export const StoryFormatSchema = z.enum(STORY_FORMATS);

export const DBT_CHARTS_BOARD_PREFIX = 'dbt-charts:';

export const DbtChartsDiagnosticSchema = z.object({
	code: z.string(),
	message: z.string(),
	level: z.enum(['error', 'warning']),
	fix: z.string().nullable(),
	hint: z.string().nullable(),
	chart: z.string().nullable(),
	query: z.string().nullable(),
	path: z.string().nullable(),
	line: z.number().nullable(),
});
export type DbtChartsDiagnostic = z.infer<typeof DbtChartsDiagnosticSchema>;

export const DbtChartsControlSchema = z.object({
	name: z.string(),
	input: z.string(),
	label: z.string(),
	value: z.unknown(),
	options: z.array(z.string()),
	enabled: z.boolean(),
	can_unset: z.boolean(),
	slider_min: z.number().nullable(),
	slider_max: z.number().nullable(),
	slider_step: z.number().nullable(),
});
export type DbtChartsControl = z.infer<typeof DbtChartsControlSchema>;

export const DbtChartsValidationSchema = z.object({
	success: z.boolean(),
	title: z.string().nullable(),
	errors: z.array(DbtChartsDiagnosticSchema),
	warnings: z.array(DbtChartsDiagnosticSchema),
});
export type DbtChartsValidation = z.infer<typeof DbtChartsValidationSchema>;

export const DbtChartsRenderSchema = z.object({
	title: z.string().nullable(),
	svg: z.string().nullable(),
	variables: z.record(z.unknown()),
	controls: z.array(DbtChartsControlSchema),
	board_error: DbtChartsDiagnosticSchema.nullable(),
	chart_errors: z.array(DbtChartsDiagnosticSchema),
	warnings: z.array(DbtChartsDiagnosticSchema),
});
export type DbtChartsRender = z.infer<typeof DbtChartsRenderSchema>;

export const DbtChartsStatusSchema = z.object({
	available: z.boolean(),
	version: z.string().nullable(),
	install_hint: z.string().nullable(),
});
export type DbtChartsStatus = z.infer<typeof DbtChartsStatusSchema>;

export type DbtChartsVariables = Record<string, unknown>;

/** Project boards live in `charts/` and are addressed by their path relative to the project root. */
export function isDbtChartsBoardId(storyId: string): boolean {
	return storyId.startsWith(DBT_CHARTS_BOARD_PREFIX);
}

export function dbtChartsBoardIdToPath(storyId: string): string {
	return storyId.slice(DBT_CHARTS_BOARD_PREFIX.length);
}

export function dbtChartsBoardPathToId(boardPath: string): string {
	return `${DBT_CHARTS_BOARD_PREFIX}${boardPath}`;
}

export function formatDbtChartsDiagnostic(diagnostic: DbtChartsDiagnostic): string {
	const location = diagnostic.path ?? diagnostic.chart ?? diagnostic.query;
	const prefix = location ? `${location}: ` : '';
	const fix = diagnostic.fix ? ` Fix: ${diagnostic.fix}` : '';
	return `${prefix}${diagnostic.message}${fix}`;
}
