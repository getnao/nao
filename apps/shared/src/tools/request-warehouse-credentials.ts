import z from 'zod/v3';

export const PROVIDERS = [
	'athena',
	'bigquery',
	'clickhouse',
	'databricks',
	'fabric',
	'motherduck',
	'mssql',
	'mysql',
	'postgres',
	'redshift',
	'snowflake',
	'starrocks',
	'trino',
] as const;

export const ProviderSchema = z.enum(PROVIDERS);

export const InputSchema = z.object({
	provider: ProviderSchema.describe('The lowercase identifier of the warehouse provider selected by the user.'),
});

export const OutputSchema = InputSchema.extend({
	_version: z.literal('1').optional(),
	status: z.literal('credentials-required'),
});

export type Provider = z.infer<typeof ProviderSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
