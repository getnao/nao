import z from 'zod/v3';

export const DATABASE_WAREHOUSE_QUESTION = 'Which database are you using?';
export const DATABASE_WAREHOUSE_OPTIONS = [
	'Amazon Athena',
	'BigQuery',
	'ClickHouse',
	'Databricks',
	'DuckDB',
	'Microsoft Fabric',
	'MotherDuck',
	'Microsoft SQL Server / Azure SQL',
	'MySQL',
	'Postgres',
	'Amazon Redshift',
	'Snowflake',
	'StarRocks',
	'Trino',
] as const;

const questionSchema = z
	.string()
	.min(1)
	.describe(
		'A single, focused question to ask the user. Keep it short, specific, and actionable. Ask only one thing at a time.',
	);
const optionSchema = z
	.string()
	.describe('A short, distinct candidate answer the user can pick with one click. Keep under ~60 chars.');
const standardClarificationSchema = z.object({
	question: questionSchema,
	options: z
		.array(optionSchema)
		.min(2)
		.max(5, 'Clarification questions may contain at most five options.')
		.optional()
		.describe(
			'Optional 2-5 mutually exclusive answer choices. Provide options whenever the answer is naturally enumerable; omit when the question is open-ended.',
		),
});
const warehouseClarificationSchema = z.object({
	question: z.literal(DATABASE_WAREHOUSE_QUESTION),
	options: z
		.array(z.enum(DATABASE_WAREHOUSE_OPTIONS))
		.length(DATABASE_WAREHOUSE_OPTIONS.length)
		.describe('The complete supported database option list.'),
});

export const InputSchema = z
	.union([warehouseClarificationSchema, standardClarificationSchema])
	.superRefine(({ options, question }, context) => {
		if (question !== DATABASE_WAREHOUSE_QUESTION) {
			return;
		}
		if (!options) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['options'],
				message: 'The database warehouse question must use the complete supported option list.',
			});
			return;
		}
		const warehouseOptions = new Set<string>(DATABASE_WAREHOUSE_OPTIONS);
		const isCompleteWarehouseSelection =
			options.length === DATABASE_WAREHOUSE_OPTIONS.length &&
			options.every((option) => warehouseOptions.has(option)) &&
			new Set(options).size === DATABASE_WAREHOUSE_OPTIONS.length;

		if (!isCompleteWarehouseSelection) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['options'],
				message: 'The database warehouse question must use the complete supported option list.',
			});
		}
	});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.literal(true),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
