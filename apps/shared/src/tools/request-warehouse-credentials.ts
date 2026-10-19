import z from 'zod/v3';

export const WAREHOUSE_PROVIDER_LABELS = {
	athena: 'Amazon Athena',
	bigquery: 'BigQuery',
	clickhouse: 'ClickHouse',
	databricks: 'Databricks',
	fabric: 'Microsoft Fabric',
	motherduck: 'MotherDuck',
	mssql: 'Microsoft SQL Server / Azure SQL',
	mysql: 'MySQL',
	postgres: 'Postgres',
	redshift: 'Amazon Redshift',
	snowflake: 'Snowflake',
	starrocks: 'StarRocks',
	trino: 'Trino',
} as const;

export type Provider = keyof typeof WAREHOUSE_PROVIDER_LABELS;

export const WAREHOUSE_PROVIDER_ALIASES: Partial<Record<Provider, readonly string[]>> = {
	athena: ['Athena'],
	fabric: ['Fabric'],
	mssql: ['MSSQL', 'SQL Server'],
	postgres: ['PostgreSQL'],
	redshift: ['Redshift'],
};

export const PROVIDERS = Object.keys(WAREHOUSE_PROVIDER_LABELS) as [Provider, ...Provider[]];

export const ProviderSchema = z.enum(PROVIDERS);

export const InputSchema = z.object({
	provider: ProviderSchema.describe('The lowercase identifier of the warehouse provider selected by the user.'),
});

export const OutputSchema = InputSchema.extend({
	_version: z.literal('1').optional(),
	status: z.literal('credentials-required'),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
