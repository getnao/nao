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
const standardOptionsSchema = z.array(optionSchema).min(2).max(5);
const warehouseOptionsSchema = z.array(z.enum(DATABASE_WAREHOUSE_OPTIONS)).length(DATABASE_WAREHOUSE_OPTIONS.length);
const optionsSchema = z
	.union([standardOptionsSchema, warehouseOptionsSchema])
	.optional()
	.describe(
		`Optional 2-5 mutually exclusive answer choices. Provide options whenever the answer is naturally enumerable; omit when the question is open-ended. For "${DATABASE_WAREHOUSE_QUESTION}", provide every supported database option.`,
	);

export const InputSchema = z
	.object({
		question: questionSchema,
		options: optionsSchema,
	})
	.superRefine(({ options, question }, context) => {
		if (question !== DATABASE_WAREHOUSE_QUESTION) {
			if (options && options.length > 5) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['options'],
					message: 'Clarification questions may contain at most five options.',
				});
			}
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
